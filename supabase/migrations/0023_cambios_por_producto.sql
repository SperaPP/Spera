-- 0023_cambios_por_producto.sql — Cambio unificado y por producto (escaneo + FIFO).
--
-- Un solo flujo para mostrador y mayorista:
--   1) Alcance: cliente (mayorista, busca en TODOS sus pedidos) o ticket (minorista).
--   2) Se escanean las prendas a devolver (por variante). Cada unidad se matchea
--      contra la compra más antigua elegible (FIFO), dentro de 30 días, sin devolver,
--      acreditando al PRECIO PAGADO en ese pedido.
--   3) Prenda(s) nueva(s).
--   4) Liquidación:
--        · Minorista: se usa todo en la operación, diferencia en efectivo, lo que
--          sobra se pierde.
--        · Mayorista: la diferencia se puede fiar; lo que sobra del crédito queda a
--          favor en la cuenta corriente (no se pierde). Puede devolver sin llevar nada.
-- Append-only e idempotente.

-- exchanges: origen ya no es un único pedido (mayorista cruza pedidos), y puede no
-- haber venta nueva (devolución pura mayorista).
alter table public.exchanges alter column original_sale_id drop not null;
alter table public.exchanges alter column new_sale_id      drop not null;
alter table public.exchanges add column if not exists customer_id uuid references public.customers(id);

drop function if exists public.create_exchange(uuid, uuid, uuid, jsonb, jsonb, jsonb);

create or replace function public.create_exchange(
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_customer_id     uuid,   -- mayorista (busca en sus pedidos). null = minorista
  p_scope_sale      uuid,   -- minorista: el ticket. null = mayorista
  p_returned        jsonb,  -- [{ variant_id, quantity }]
  p_price_list_id   uuid,   -- lista para la venta nueva (perfil mayorista / Publico)
  p_new_items       jsonb,  -- [{ variant_id, product_name, variant_label, quantity, unit_price }]
  p_diff_payments   jsonb   -- [{ payment_method_id, amount }] (diferencia)
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid;
  v_credit numeric := 0; v_new_total numeric := 0; v_applied numeric; v_leftover numeric; v_diff numeric;
  v_real numeric := 0; v_cc numeric := 0; v_paid numeric := 0;
  v_cambio uuid; v_new_sale uuid;
  v_el jsonb; v_variant uuid; v_need integer; v_lot record; v_take integer; v_qty integer;
  v_kind text; v_amt numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if (p_customer_id is null) = (p_scope_sale is null) then
    raise exception 'Definí el alcance: cliente (mayorista) o ticket (minorista)';
  end if;

  select warehouse_id into v_wh from public.stores where id = p_store_id and organization_id = v_org;
  if v_wh is null then raise exception 'Local inválido'; end if;

  -- ── Devoluciones: matching FIFO por variante ───────────────
  if p_returned is null or jsonb_array_length(p_returned) = 0 then raise exception 'No escaneaste ninguna prenda a devolver'; end if;
  for v_el in select e from jsonb_array_elements(p_returned) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_need := (v_el->>'quantity')::integer;
    if v_need <= 0 then continue; end if;

    for v_lot in
      select si.id, si.unit_price, (si.quantity - si.returned_qty) as avail
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
      where s.organization_id = v_org and s.status = 'completada'
        and s.created_at >= now() - interval '30 days'
        and si.variant_id = v_variant
        and (si.quantity - si.returned_qty) > 0
        and ( (p_customer_id is not null and s.customer_id = p_customer_id)
           or (p_scope_sale   is not null and s.id = p_scope_sale) )
      order by s.created_at asc
      for update
    loop
      exit when v_need <= 0;
      v_take := least(v_need, v_lot.avail);
      v_credit := v_credit + v_take * v_lot.unit_price;
      update public.sale_items set returned_qty = returned_qty + v_take where id = v_lot.id;
      v_need := v_need - v_take;
    end loop;

    if v_need > 0 then
      raise exception 'No hay suficientes unidades elegibles (30 días, sin devolver) de una de las prendas escaneadas';
    end if;

    -- Reingreso de stock al local del cambio (total de esa variante).
    v_qty := (v_el->>'quantity')::integer;
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
      values (v_org, v_wh, v_variant, v_qty)
      on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + v_qty, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_wh, v_variant, v_qty, 'cambio', 'exchange', coalesce(p_scope_sale, p_customer_id), auth.uid());
  end loop;

  -- ── Prenda nueva ───────────────────────────────────────────
  select coalesce(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    into v_new_total from jsonb_array_elements(coalesce(p_new_items,'[]'::jsonb)) e;

  -- Clasificar pagos de la diferencia.
  for v_el in select e from jsonb_array_elements(coalesce(p_diff_payments,'[]'::jsonb)) as e
  loop
    v_amt := (v_el->>'amount')::numeric;
    select kind into v_kind from public.payment_methods where id = (v_el->>'payment_method_id')::uuid;
    if v_kind = 'cuenta_corriente' then v_cc := v_cc + v_amt; else v_real := v_real + v_amt; end if;
  end loop;
  v_paid := v_real + v_cc;

  -- Devolución pura (sin prenda nueva): sólo mayorista → todo a saldo a favor.
  if v_new_total = 0 then
    if p_customer_id is null then raise exception 'Elegí la prenda nueva del cambio'; end if;
    if v_paid > 0 then raise exception 'No hay diferencia a cobrar'; end if;
    update public.customers set balance = balance - v_credit where id = p_customer_id;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, -v_credit, 'cambio', 'exchange', null, auth.uid());
    insert into public.exchanges (organization_id, store_id, original_sale_id, new_sale_id, customer_id, credit, difference, forfeited, created_by)
      values (v_org, p_store_id, p_scope_sale, null, p_customer_id, v_credit, 0, 0, auth.uid());
    return null;
  end if;

  v_applied := least(v_credit, v_new_total);
  v_leftover := v_credit - v_applied;
  v_diff := v_new_total - v_applied;   -- >= 0

  if p_customer_id is null then
    -- Minorista: sólo efectivo/tarjeta, diferencia exacta, sobrante se pierde.
    if v_cc > 0 then raise exception 'En mostrador no se puede fiar'; end if;
    if v_real < v_diff then raise exception 'Falta cobrar la diferencia'; end if;
    if v_real > v_diff then raise exception 'La diferencia cobrada es mayor a la que corresponde'; end if;
  else
    -- Mayorista: efectivo/tarjeta o fiar; sobrante del crédito → saldo a favor.
    if v_paid < v_diff then raise exception 'Falta cubrir la diferencia'; end if;
    if v_paid > v_diff then raise exception 'El pago supera la diferencia'; end if;
  end if;

  -- Venta nueva (canal cambio).
  select id into v_cambio from public.payment_methods where organization_id = v_org and kind = 'cambio' limit 1;
  insert into public.sales (organization_id, store_id, cash_session_id, customer_id, price_list_id, channel, subtotal, discount, total, created_by)
    values (v_org, p_store_id, p_cash_session_id, p_customer_id, p_price_list_id, 'cambio', v_new_total, 0, v_new_total, auth.uid())
    returning id into v_new_sale;

  for v_el in select e from jsonb_array_elements(p_new_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;
    insert into public.sale_items (sale_id, variant_id, product_name, variant_label, quantity, unit_price, line_total)
      values (v_new_sale, v_variant, v_el->>'product_name', nullif(v_el->>'variant_label',''), v_qty, (v_el->>'unit_price')::numeric, v_qty * (v_el->>'unit_price')::numeric);
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
      values (v_org, v_wh, v_variant, -v_qty)
      on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity - v_qty, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_wh, v_variant, -v_qty, 'venta', 'sale', v_new_sale, auth.uid());
  end loop;

  -- Pagos de la venta nueva: crédito aplicado (Cambio) + diferencia.
  if v_applied > 0 and v_cambio is not null then
    insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge) values (v_new_sale, v_cambio, v_applied, 0);
  end if;
  for v_el in select e from jsonb_array_elements(coalesce(p_diff_payments,'[]'::jsonb)) as e
  loop
    insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
      values (v_new_sale, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric, 0);
  end loop;

  -- Cuenta corriente de la diferencia (mayorista fía) → suma deuda.
  if p_customer_id is not null and v_cc > 0 then
    update public.customers set balance = balance + v_cc where id = p_customer_id;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, v_cc, 'venta', 'sale', v_new_sale, auth.uid());
  end if;

  -- Mayorista: crédito sobrante → saldo a favor.
  if p_customer_id is not null and v_leftover > 0 then
    update public.customers set balance = balance - v_leftover where id = p_customer_id;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, -v_leftover, 'cambio', 'exchange', v_new_sale, auth.uid());
  end if;

  insert into public.exchanges (organization_id, store_id, original_sale_id, new_sale_id, customer_id, credit, difference, forfeited, created_by)
    values (v_org, p_store_id, p_scope_sale, v_new_sale, p_customer_id, v_credit, v_diff,
            case when p_customer_id is null then v_leftover else 0 end, auth.uid());

  return v_new_sale;
end; $$;
