-- 0044_no_vender_sin_stock.sql — Nunca vender sin stock + blindar anulación de cambios.
--
-- 1) create_sale: antes descontaba con upsert (insert ... on conflict do update
--    set quantity = quantity - qty), sin piso → podía dejar stock negativo (vender
--    lo que no hay). Ahora verifica stock disponible en el depósito del local y
--    corta si no alcanza.
-- 2) create_exchange: mismo piso para la prenda nueva del cambio.
-- 3) cancel_sale: además del guard de returned_qty (0043), bloquea anular una venta
--    de canal 'cambio' (el new_sale de un cambio). Anularla deja la operación a
--    medias (la prenda devuelta y su crédito viven aparte). Para deshacer un cambio
--    hay que hacer el cambio inverso.
-- El portal (portal_create_order) ya validaba stock; no se toca.
-- Append-only e idempotente.

-- ── 1) create_sale con piso de stock ──────────────────────────────────────────
create or replace function public.create_sale(
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_customer_id     uuid,
  p_price_list_id   uuid,
  p_coupon_id       uuid,
  p_customer_data   jsonb,
  p_items           jsonb,
  p_payments        jsonb
) returns uuid language plpgsql as $$
declare
  v_org      uuid := public.current_org_id();
  v_wh       uuid;
  v_sale     uuid;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total    numeric := 0;
  v_el       jsonb;
  v_qty      integer;
  v_variant  uuid;
  v_have     numeric;
  c          record;
  v_cc       numeric := 0;
  v_credit   numeric := 0;
  v_real     numeric := 0;
  v_kind     text;
  v_amt      numeric;
  v_balance  numeric;
  v_due_acct numeric;
  v_excess   numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select warehouse_id into v_wh from public.stores where id = p_store_id and organization_id = v_org;
  if v_wh is null then raise exception 'Local inválido'; end if;

  select coalesce(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) e;

  -- Cupón.
  if p_coupon_id is not null then
    select * into c from public.coupons where id = p_coupon_id and organization_id = v_org for update;
    if not found then raise exception 'Cupón inexistente'; end if;
    if not c.active then raise exception 'El cupón está inactivo'; end if;
    if c.expires_at is not null and c.expires_at < current_date then raise exception 'El cupón está vencido'; end if;
    if c.max_uses is not null and c.used_count >= c.max_uses then raise exception 'El cupón alcanzó su límite de usos'; end if;
    if c.min_amount is not null and v_subtotal < c.min_amount then raise exception 'La compra no alcanza el mínimo del cupón'; end if;
    if c.discount_type = 'percent' then v_discount := round(v_subtotal * c.discount_value / 100);
    else v_discount := c.discount_value; end if;
    if v_discount > v_subtotal then v_discount := v_subtotal; end if;
    update public.coupons set used_count = used_count + 1 where id = p_coupon_id;
  end if;

  v_total := v_subtotal - v_discount;

  -- Clasificar los pagos por tipo.
  for v_el in select e from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) as e
  loop
    v_amt := (v_el->>'amount')::numeric;
    select kind into v_kind from public.payment_methods where id = (v_el->>'payment_method_id')::uuid;
    if v_kind = 'cuenta_corriente' then v_cc := v_cc + v_amt;
    elsif v_kind = 'saldo_favor' then v_credit := v_credit + v_amt;
    else v_real := v_real + v_amt;
    end if;
  end loop;

  -- Fiado y saldo a favor requieren cliente.
  if (v_cc > 0 or v_credit > 0) and p_customer_id is null then
    raise exception 'Fiar o usar saldo a favor requiere un cliente identificado';
  end if;

  -- Saldo a favor: no puede exceder el crédito disponible.
  if v_credit > 0 then
    select balance into v_balance from public.customers where id = p_customer_id and organization_id = v_org;
    if v_credit > greatest(0, -coalesce(v_balance,0)) then
      raise exception 'El saldo a favor disponible no alcanza';
    end if;
  end if;

  -- Cobertura del total.
  v_due_acct := v_total - v_cc - v_credit;
  if v_due_acct < 0 then raise exception 'Los pagos a cuenta superan el total'; end if;
  if v_real < v_due_acct then raise exception 'Pago insuficiente'; end if;
  v_excess := v_real - v_due_acct;
  if v_excess > 0 and p_customer_id is null then
    raise exception 'El excedente requiere un cliente (en mostrador se cobra exacto)';
  end if;

  insert into public.sales (organization_id, store_id, cash_session_id, customer_id, price_list_id,
                            coupon_id, subtotal, discount, total,
                            customer_name, customer_doc, customer_phone, customer_email, created_by)
  values (v_org, p_store_id, p_cash_session_id, p_customer_id, p_price_list_id,
          p_coupon_id, v_subtotal, v_discount, v_total,
          nullif(trim(coalesce(p_customer_data->>'name','')),''),
          nullif(trim(coalesce(p_customer_data->>'doc','')),''),
          nullif(trim(coalesce(p_customer_data->>'phone','')),''),
          nullif(trim(coalesce(p_customer_data->>'email','')),''),
          auth.uid())
  returning id into v_sale;

  -- Ítems + stock. No vender sin stock: verificar y descontar atómicamente.
  for v_el in select e from jsonb_array_elements(p_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;
    insert into public.sale_items (sale_id, variant_id, product_name, variant_label, quantity, unit_price, line_total)
    values (v_sale, v_variant, v_el->>'product_name', nullif(v_el->>'variant_label',''),
            v_qty, (v_el->>'unit_price')::numeric, v_qty * (v_el->>'unit_price')::numeric);

    select quantity into v_have from public.stock
      where warehouse_id = v_wh and variant_id = v_variant for update;
    if coalesce(v_have, 0) < v_qty then
      raise exception 'Sin stock suficiente de "%" (hay %, se piden %)',
        coalesce(nullif(v_el->>'product_name',''), 'producto') || coalesce(' ' || nullif(v_el->>'variant_label',''), ''),
        coalesce(v_have, 0), v_qty;
    end if;
    update public.stock set quantity = v_have - v_qty, updated_at = now()
      where warehouse_id = v_wh and variant_id = v_variant;

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_wh, v_variant, -v_qty, 'venta', 'sale', v_sale, auth.uid());
  end loop;

  -- Pagos.
  for v_el in select e from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) as e
  loop
    insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
    values (v_sale, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric,
            coalesce((v_el->>'surcharge')::numeric, 0));
  end loop;

  -- Movimientos de cuenta corriente.
  if p_customer_id is not null then
    if v_cc > 0 then
      update public.customers set balance = balance + v_cc where id = p_customer_id;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, v_cc, 'venta', 'sale', v_sale, auth.uid());
    end if;
    if v_credit > 0 then
      update public.customers set balance = balance + v_credit where id = p_customer_id;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, v_credit, 'saldo_favor', 'sale', v_sale, auth.uid());
    end if;
    if v_excess > 0 then
      update public.customers set balance = balance - v_excess where id = p_customer_id;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, -v_excess, 'sobrepago', 'sale', v_sale, auth.uid());
    end if;
  end if;

  return v_sale;
end; $$;

-- ── 2) create_exchange con piso de stock en la prenda nueva ────────────────────
create or replace function public.create_exchange(
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_customer_id     uuid,
  p_scope_sale      uuid,
  p_returned        jsonb,
  p_price_list_id   uuid,
  p_new_items       jsonb,
  p_diff_payments   jsonb
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid;
  v_credit numeric := 0; v_new_total numeric := 0; v_applied numeric; v_leftover numeric; v_diff numeric;
  v_real numeric := 0; v_cc numeric := 0; v_paid numeric := 0;
  v_cambio uuid; v_new_sale uuid;
  v_el jsonb; v_variant uuid; v_need integer; v_lot record; v_take integer; v_qty integer;
  v_have numeric;
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

    -- No entregar sin stock: verificar y descontar atómicamente.
    select quantity into v_have from public.stock
      where warehouse_id = v_wh and variant_id = v_variant for update;
    if coalesce(v_have, 0) < v_qty then
      raise exception 'Sin stock suficiente de "%" (hay %, se piden %)',
        coalesce(nullif(v_el->>'product_name',''), 'producto') || coalesce(' ' || nullif(v_el->>'variant_label',''), ''),
        coalesce(v_have, 0), v_qty;
    end if;
    update public.stock set quantity = v_have - v_qty, updated_at = now()
      where warehouse_id = v_wh and variant_id = v_variant;

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

-- ── 3) cancel_sale: guards de returned_qty (0043) + canal 'cambio' ─────────────
create or replace function public.cancel_sale(p_sale_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_customer uuid; v_coupon uuid; v_channel text; v_it record; v_net numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select s.customer_id, s.coupon_id, s.channel, st.warehouse_id into v_customer, v_coupon, v_channel, v_wh
  from public.sales s join public.stores st on st.id = s.store_id
  where s.id = p_sale_id and s.organization_id = v_org and s.status = 'completada';
  if not found then raise exception 'Venta no encontrada o ya anulada'; end if;

  -- Una venta que salió de un cambio no se anula directamente: la prenda devuelta
  -- y su crédito viven aparte, anularla dejaría la operación a medias. Hay que
  -- hacer el cambio inverso.
  if v_channel = 'cambio' then
    raise exception 'Esta venta proviene de un cambio. Para deshacerlo hacé el cambio inverso; no se anula directamente.';
  end if;

  -- Una venta con prendas ya devueltas/cambiadas tampoco: el cambio ya resolvió
  -- esa parte del stock y del saldo por separado.
  if exists (select 1 from public.sale_items where sale_id = p_sale_id and returned_qty > 0) then
    raise exception 'Esta venta tiene prendas ya devueltas o cambiadas. Revertí el cambio antes de anular.';
  end if;

  -- Reponer stock.
  for v_it in select variant_id, quantity from public.sale_items where sale_id = p_sale_id
  loop
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, v_wh, v_it.variant_id, v_it.quantity)
    on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + v_it.quantity, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_wh, v_it.variant_id, v_it.quantity, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
  end loop;

  -- Revertir el neto de los movimientos de cuenta corriente de esta venta.
  if v_customer is not null then
    select coalesce(sum(delta), 0) into v_net
      from public.customer_movements where reference_type = 'sale' and reference_id = p_sale_id and customer_id = v_customer;
    if v_net <> 0 then
      update public.customers set balance = balance - v_net where id = v_customer;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_customer, -v_net, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
    end if;
  end if;

  if v_coupon is not null then
    update public.coupons set used_count = greatest(used_count - 1, 0) where id = v_coupon;
  end if;

  update public.sales set status = 'anulada' where id = p_sale_id;
end; $$;
