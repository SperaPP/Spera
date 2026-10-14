-- 0114_tn_ingesta_reconcile.sql — auditoría de sistema (Tiendanube): A3, M1, M4.
--
-- A3  order/updated reconciliaba SOLO si cambiaba el total → un cambio de cantidad o
--     un swap de ítems que dejaba el mismo total no se reflejaba. Ahora reconcilia si
--     cambió el total, el subtotal, la cantidad de líneas o la suma de unidades.
--     (Residual conocido: un swap 1:1 de variante al MISMO precio y cantidad no se
--     detecta por conteo; es muy raro y se puede forzar con "Reparar"/edición manual.)
-- M1  Un pedido ya pago al que se le cambia el total dejaba el sale_payment viejo
--     (paid_amount y el pago no cuadraban). Ahora el pago online se sincroniza al total.
-- M4  Cancelar en TN un pedido YA DESPACHADO reponía físico fantasma. Ahora, si ya
--     salió (despachado/entregado), NO se repone automático: si vuelve, se carga como
--     devolución/ajuste manual. Solo libera reserva si estaba pendiente/controlado.
-- tn_apply_items / tn_revert_items quedan igual (0068). Append-only e idempotente.

create or replace function public.ingest_tn_order(p_org uuid, p_payload jsonb)
returns jsonb language plpgsql as $$
declare
  v_store uuid; v_wh uuid; v_method uuid;
  v_tn_id    text    := p_payload->>'tn_order_id';
  v_status   text    := coalesce(p_payload->>'status', 'open');
  v_paid     boolean := coalesce((p_payload->>'paid')::boolean, false);
  v_total    numeric := coalesce((p_payload->>'total')::numeric, 0);
  v_subtotal numeric := coalesce((p_payload->>'subtotal')::numeric, coalesce((p_payload->>'total')::numeric, 0));
  v_discount numeric := coalesce((p_payload->>'discount')::numeric, 0);
  v_sale uuid; v_sale_status text; v_paid_amount numeric; v_fs text; v_cur_total numeric;
  v_cur_subtotal numeric; v_it record;
  v_pl_count int; v_pl_qty int; v_cur_count int; v_cur_qty int;
begin
  if p_org is null then raise exception 'Falta organización'; end if;
  if nullif(trim(coalesce(v_tn_id,'')),'') is null then raise exception 'Falta tn_order_id'; end if;

  select id, warehouse_id into v_store, v_wh
    from public.stores where organization_id = p_org and name = 'Tiendanube' limit 1;
  if v_store is null then raise exception 'No existe el local Tiendanube'; end if;
  select id into v_method from public.payment_methods
    where organization_id = p_org and name = 'Pago online / Tiendanube' limit 1;

  select id, status, paid_amount, fulfillment_status, total, subtotal
    into v_sale, v_sale_status, v_paid_amount, v_fs, v_cur_total, v_cur_subtotal
    from public.sales where organization_id = p_org and tn_order_id = v_tn_id for update;

  -- ── Caso 1: la venta no existe todavía ──────────────────────────────────────
  if v_sale is null then
    if v_status = 'cancelled' then
      return jsonb_build_object('action', 'skip_cancelled', 'tn_order_id', v_tn_id);
    end if;

    insert into public.sales (organization_id, store_id, customer_id, channel,
        subtotal, discount, total, paid_amount,
        customer_name, customer_doc, customer_phone, customer_email, customer_address,
        tn_order_id, tn_order_number)
    values (p_org, v_store, null, 'tiendanube',
        v_subtotal, v_discount, v_total, case when v_paid then v_total else 0 end,
        nullif(trim(coalesce(p_payload#>>'{buyer,name}', '')), ''),
        nullif(trim(coalesce(p_payload#>>'{buyer,doc}', '')), ''),
        nullif(trim(coalesce(p_payload#>>'{buyer,phone}', '')), ''),
        nullif(trim(coalesce(p_payload#>>'{buyer,email}', '')), ''),
        nullif(trim(coalesce(p_payload#>>'{buyer,address}', '')), ''),
        v_tn_id, nullif(trim(coalesce(p_payload->>'tn_number', '')), ''))
    on conflict (organization_id, tn_order_id) where tn_order_id is not null do nothing
    returning id into v_sale;

    if v_sale is not null then
      perform public.tn_apply_items(v_sale, p_org, v_wh, p_payload);
      if v_paid and v_method is not null then
        insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
        values (v_sale, v_method, v_total, 0);
      end if;
      return jsonb_build_object('action', 'created', 'sale_id', v_sale, 'paid', v_paid);
    end if;

    select id, status, paid_amount, fulfillment_status, total, subtotal
      into v_sale, v_sale_status, v_paid_amount, v_fs, v_cur_total, v_cur_subtotal
      from public.sales where organization_id = p_org and tn_order_id = v_tn_id for update;
  end if;

  -- ── Caso 2: la venta ya existe ──────────────────────────────────────────────
  if v_sale_status = 'anulada' then
    return jsonb_build_object('action', 'already_cancelled', 'sale_id', v_sale);
  end if;

  -- 2a) TN canceló el pedido → anular acá.
  if v_status = 'cancelled' then
    for v_it in select variant_id, quantity from public.sale_items where sale_id = v_sale and variant_id is not null
    loop
      -- Solo libera la reserva si todavía no salió. Si ya se despachó/entregó, la
      -- mercadería salió: NO se repone físico automático (evita stock fantasma); una
      -- devolución real se carga a mano.
      if v_fs in ('pendiente', 'controlado') then
        update public.stock set reserved = greatest(coalesce(reserved,0) - v_it.quantity, 0), updated_at = now()
          where warehouse_id = v_wh and variant_id = v_it.variant_id;
      end if;
    end loop;
    update public.sales set status = 'anulada' where id = v_sale;
    return jsonb_build_object('action', 'cancelled', 'sale_id', v_sale);
  end if;

  -- 2b) order/updated: el pedido se editó en TN y sigue 'pendiente' → reconciliar
  -- ítems + reserva + totales. Dispara si cambió el total, el subtotal, la cantidad
  -- de líneas o la suma de unidades (no solo el total, como antes).
  if v_fs = 'pendiente' then
    select count(*) filter (where coalesce((e->>'quantity')::int, 0) > 0),
           coalesce(sum((e->>'quantity')::int) filter (where coalesce((e->>'quantity')::int, 0) > 0), 0)
      into v_pl_count, v_pl_qty
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) e;

    select count(*), coalesce(sum(quantity), 0) into v_cur_count, v_cur_qty
      from public.sale_items where sale_id = v_sale and coalesce(product_name, '') <> 'Envío';

    if abs(coalesce(v_cur_total, 0) - v_total) > 0.01
       or abs(coalesce(v_cur_subtotal, 0) - v_subtotal) > 0.01
       or coalesce(v_cur_count, 0) <> coalesce(v_pl_count, 0)
       or coalesce(v_cur_qty, 0) <> coalesce(v_pl_qty, 0) then
      perform public.tn_revert_items(v_sale, v_wh);
      perform public.tn_apply_items(v_sale, p_org, v_wh, p_payload);
      update public.sales set subtotal = v_subtotal, discount = v_discount, total = v_total,
        paid_amount = least(coalesce(paid_amount, 0), v_total) where id = v_sale;
      v_paid_amount := least(coalesce(v_paid_amount, 0), v_total);
      -- M1: mantener el pago online consistente con el nuevo total (si el pedido ya tenía pago).
      if v_method is not null then
        update public.sale_payments set amount = v_paid_amount
          where sale_id = v_sale and payment_method_id = v_method;
      end if;
    end if;
  end if;

  -- 2c) TN marcó pago y acá está impago → registrar/ajustar el cobro y destrabar.
  if v_paid and coalesce(v_paid_amount, 0) < v_total - 0.01 then
    update public.sales set paid_amount = v_total where id = v_sale;
    if v_method is not null then
      if exists (select 1 from public.sale_payments where sale_id = v_sale and payment_method_id = v_method) then
        update public.sale_payments set amount = v_total where sale_id = v_sale and payment_method_id = v_method;
      else
        insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
        values (v_sale, v_method, v_total, 0);
      end if;
    end if;
    return jsonb_build_object('action', 'marked_paid', 'sale_id', v_sale);
  end if;

  return jsonb_build_object('action', 'noop', 'sale_id', v_sale);
end; $$;

notify pgrst, 'reload schema';
