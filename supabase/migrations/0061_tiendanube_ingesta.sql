-- 0061_tiendanube_ingesta.sql — Tanda 3c: ingesta de pedidos de la web.
--
-- Un pedido de Tiendanube entra a Spera como venta channel='tiendanube':
--   · al crearse el pedido → reserva stock en Mayorista-Central, queda trabado
--     (logística 'pendiente', paid_amount 0). No se despacha hasta estar pago.
--   · cuando el pedido se paga → paid_amount = total + cobro con medio
--     "Pago online / Tiendanube" (ingreso real, sin caja física) → despachable.
--   · si TN lo cancela → se anula acá y libera la reserva.
--   · si nunca paga → el admin lo cancela manual (como un pedido de portal).
-- El comprador es un SNAPSHOT en la venta (no se crea cliente). Idempotente por
-- tn_order_id: reprocesar el mismo webhook no duplica ni rompe.
-- Append-only e idempotente.

-- ── 1) Campos del pedido web en la venta ──────────────────────────────────────
alter table public.sales add column if not exists tn_order_id     text;
alter table public.sales add column if not exists tn_order_number text;
alter table public.sales add column if not exists customer_address text;
create unique index if not exists sales_tn_order_uq
  on public.sales (organization_id, tn_order_id) where tn_order_id is not null;

-- ── 2) Medio de pago "Pago online / Tiendanube" (ingreso real, no suma a caja) ─
insert into public.payment_methods (organization_id, name, kind, affects_cash, active, position)
select o.id, 'Pago online / Tiendanube', 'digital', false, true, 50
from public.organizations o
on conflict (organization_id, name) do nothing;

-- ── 3) fulfillment: los pedidos 'tiendanube' arrancan 'pendiente' (a despachar) ─
create or replace function public.set_fulfillment_status() returns trigger language plpgsql as $$
begin
  if new.channel = 'cambio' then
    new.fulfillment_status := 'entregado';
  elsif new.channel = 'tiendanube'
     or exists (select 1 from public.stores st where st.id = new.store_id and st.is_wholesale) then
    new.fulfillment_status := 'pendiente';
  else
    new.fulfillment_status := 'entregado';
  end if;
  return new;
end; $$;

-- ── 4) ingest_tn_order: reconcilia el pedido web con la venta en Spera ─────────
-- La llama el webhook (service-role), por eso recibe la organización explícita
-- (no usa current_org_id, que en ese contexto es null).
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
  v_sale uuid; v_sale_status text; v_paid_amount numeric; v_fs text;
  v_el jsonb; v_it record; v_variant uuid; v_qty int; v_have numeric; v_res numeric;
begin
  if p_org is null then raise exception 'Falta organización'; end if;
  if nullif(trim(coalesce(v_tn_id,'')),'') is null then raise exception 'Falta tn_order_id'; end if;

  select id, warehouse_id into v_store, v_wh
    from public.stores where organization_id = p_org and name = 'Tiendanube' limit 1;
  if v_store is null then raise exception 'No existe el local Tiendanube'; end if;
  select id into v_method from public.payment_methods
    where organization_id = p_org and name = 'Pago online / Tiendanube' limit 1;

  select id, status, paid_amount, fulfillment_status
    into v_sale, v_sale_status, v_paid_amount, v_fs
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
    on conflict (organization_id, tn_order_id) do nothing
    returning id into v_sale;

    -- Si otro webhook simultáneo la creó primero, caemos al Caso 2.
    if v_sale is not null then
      for v_el in select e from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) e
      loop
        v_qty := coalesce((v_el->>'quantity')::int, 0);
        if v_qty <= 0 then continue; end if;

        v_variant := null;
        if nullif(v_el->>'tn_variant_id', '') is not null then
          select variant_id into v_variant from public.tiendanube_links
            where organization_id = p_org and tn_variant_id = v_el->>'tn_variant_id' limit 1;
        end if;
        if v_variant is null and nullif(v_el->>'sku', '') is not null then
          select id into v_variant from public.product_variants
            where organization_id = p_org and lower(sku) = lower(v_el->>'sku') limit 1;
        end if;

        insert into public.sale_items (sale_id, variant_id, product_name, variant_label, quantity, unit_price, line_total)
        values (v_sale, v_variant,
            coalesce(nullif(v_el->>'product_name', ''), '(producto web)'),
            nullif(v_el->>'variant_label', ''),
            v_qty, coalesce((v_el->>'unit_price')::numeric, 0), v_qty * coalesce((v_el->>'unit_price')::numeric, 0));

        -- Reserva en Central si la variante matchea. Clamp al físico para respetar
        -- la invariante reserved<=quantity (con stock sincronizado no debería topar).
        if v_variant is not null then
          select quantity, reserved into v_have, v_res from public.stock
            where warehouse_id = v_wh and variant_id = v_variant for update;
          if not found then
            insert into public.stock (organization_id, warehouse_id, variant_id, quantity, reserved)
            values (p_org, v_wh, v_variant, 0, 0);
            v_have := 0; v_res := 0;
          end if;
          update public.stock set reserved = least(coalesce(v_have,0), coalesce(v_res,0) + v_qty), updated_at = now()
            where warehouse_id = v_wh and variant_id = v_variant;
        end if;
      end loop;

      if v_paid and v_method is not null then
        insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
        values (v_sale, v_method, v_total, 0);
      end if;

      return jsonb_build_object('action', 'created', 'sale_id', v_sale, 'paid', v_paid);
    end if;

    -- Perdió la carrera: re-leo la venta que creó el otro webhook y sigo al Caso 2.
    select id, status, paid_amount, fulfillment_status
      into v_sale, v_sale_status, v_paid_amount, v_fs
      from public.sales where organization_id = p_org and tn_order_id = v_tn_id for update;
  end if;

  -- ── Caso 2: la venta ya existe ──────────────────────────────────────────────
  if v_sale_status = 'anulada' then
    return jsonb_build_object('action', 'already_cancelled', 'sale_id', v_sale);
  end if;

  -- 2a) TN canceló el pedido → anular acá y liberar la reserva.
  if v_status = 'cancelled' then
    for v_it in select variant_id, quantity from public.sale_items where sale_id = v_sale and variant_id is not null
    loop
      if v_fs in ('pendiente', 'controlado') then
        update public.stock set reserved = greatest(coalesce(reserved,0) - v_it.quantity, 0), updated_at = now()
          where warehouse_id = v_wh and variant_id = v_it.variant_id;
      else
        -- ya despachado: el físico salió, se repone.
        insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
        values (p_org, v_wh, v_it.variant_id, v_it.quantity)
        on conflict (warehouse_id, variant_id) do update set quantity = public.stock.quantity + v_it.quantity, updated_at = now();
      end if;
    end loop;
    update public.sales set status = 'anulada' where id = v_sale;
    return jsonb_build_object('action', 'cancelled', 'sale_id', v_sale);
  end if;

  -- 2b) TN marcó pago y acá está impago → registrar el cobro (medio TN) y destrabar.
  if v_paid and coalesce(v_paid_amount, 0) < v_total - 0.01 then
    update public.sales set paid_amount = v_total where id = v_sale;
    if v_method is not null
       and not exists (select 1 from public.sale_payments where sale_id = v_sale and payment_method_id = v_method) then
      insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
      values (v_sale, v_method, v_total, 0);
    end if;
    return jsonb_build_object('action', 'marked_paid', 'sale_id', v_sale);
  end if;

  return jsonb_build_object('action', 'noop', 'sale_id', v_sale);
end; $$;
