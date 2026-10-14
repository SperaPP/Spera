-- 0109_consistencia_cobranzas.sql — auditoría de sistema: #2 y #5 (plata/consistencia).
--
-- #2  cancel_sale: un pedido fiado con una COBRANZA imputada podía anularse, y al
--     anular después la cobranza se revertía DOS VECES el mismo dinero → al cliente
--     se le "comía" la plata (pagó, no recibió nada y su saldo quedaba en 0). Ahora
--     cancel_sale RECHAZA anular un pedido que tenga cobranzas vivas: primero se
--     anula la cobranza (restaura el saldo) y recién después el pedido.
-- #5  edit_sale: editar a la baja un pedido ya cobrado dejaba paid_amount > total y
--     una allocation mayor al total. Ahora se rechaza bajar el total por debajo de
--     lo ya cobrado por recibos vivos (hay que anular/ajustar la cobranza primero).
-- Cuerpos tomados de su versión vigente (cancel_sale 0086, edit_sale 0100) + el
-- chequeo nuevo. Append-only e idempotente.

-- ── #2: cancel_sale rechaza pedidos con cobranza imputada ─────
create or replace function public.cancel_sale(p_sale_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_customer uuid; v_coupon uuid; v_channel text; v_fs text; v_it record; v_net numeric;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  if not public.is_admin() then raise exception 'Solo un administrador puede anular ventas'; end if;

  select s.customer_id, s.coupon_id, s.channel, s.fulfillment_status, st.warehouse_id
    into v_customer, v_coupon, v_channel, v_fs, v_wh
  from public.sales s join public.stores st on st.id = s.store_id
  where s.id = p_sale_id and s.organization_id = v_org and s.status = 'completada'
  for update of s;
  if not found then raise exception 'Venta no encontrada o ya anulada'; end if;

  -- #2: si el pedido tiene una cobranza viva imputada, no se puede anular directo
  -- (si no, anular la cobranza después revierte el mismo dinero dos veces).
  if exists (
    select 1 from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
    where ra.sale_id = p_sale_id and r.status <> 'anulada'
  ) then
    raise exception 'Este pedido tiene una cobranza imputada. Anulá primero la cobranza y después el pedido.';
  end if;

  if v_channel = 'cambio' then
    raise exception 'Esta venta proviene de un cambio. Para deshacerlo hacé el cambio inverso; no se anula directamente.';
  end if;

  if v_fs = 'despachado' then
    raise exception 'Este pedido ya fue despachado. Para revertirlo hacé una devolución/ajuste; no se anula directamente.';
  end if;

  if exists (select 1 from public.sale_items where sale_id = p_sale_id and returned_qty > 0) then
    raise exception 'Esta venta tiene prendas ya devueltas o cambiadas. Revertí el cambio antes de anular.';
  end if;

  for v_it in select variant_id, quantity from public.sale_items where sale_id = p_sale_id
  loop
    if v_fs in ('pendiente', 'controlado') then
      update public.stock set reserved = greatest(coalesce(reserved,0) - v_it.quantity, 0), updated_at = now()
        where warehouse_id = v_wh and variant_id = v_it.variant_id;
    else
      insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
      values (v_org, v_wh, v_it.variant_id, v_it.quantity)
      on conflict (warehouse_id, variant_id) do update set quantity = public.stock.quantity + v_it.quantity, updated_at = now();
      insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_wh, v_it.variant_id, v_it.quantity, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
    end if;
  end loop;

  if v_customer is not null then
    select coalesce(sum(delta), 0) into v_net
      from public.customer_movements where reference_type = 'sale' and reference_id = p_sale_id and customer_id = v_customer;
    if v_net <> 0 then
      update public.customers set balance = balance - v_net where id = v_customer;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_customer, -v_net, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
    end if;
  end if;

  -- Devuelve el uso de TODOS los cupones de la venta (o el legacy coupon_id).
  if exists (select 1 from public.sale_coupons where sale_id = p_sale_id) then
    update public.coupons set used_count = greatest(used_count - 1, 0)
      where id in (select coupon_id from public.sale_coupons where sale_id = p_sale_id);
  elsif v_coupon is not null then
    update public.coupons set used_count = greatest(used_count - 1, 0) where id = v_coupon;
  end if;

  update public.sales set status = 'anulada' where id = p_sale_id;
end; $$;

-- ── #5: edit_sale no deja el total por debajo de lo ya cobrado ─
create or replace function public.edit_sale(p_sale_id uuid, p_items jsonb)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_customer uuid; v_coupon uuid; v_channel text; v_fs text; v_status text;
  v_old_total numeric; v_paid numeric;
  v_subtotal numeric := 0; v_discount numeric := 0; v_new_total numeric := 0; v_delta numeric;
  c record; v_el jsonb; v_variant uuid; v_qty integer; v_have numeric; v_res numeric;
  v_cc_method uuid; v_it record; v_alloc numeric;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  if not public.is_admin() then raise exception 'Solo un administrador puede editar pedidos'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El pedido no puede quedar sin ítems'; end if;

  select s.customer_id, s.coupon_id, s.channel, s.fulfillment_status, s.status, s.total, s.paid_amount, st.warehouse_id
    into v_customer, v_coupon, v_channel, v_fs, v_status, v_old_total, v_paid, v_wh
  from public.sales s join public.stores st on st.id = s.store_id
  where s.id = p_sale_id and s.organization_id = v_org
  for update of s;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if v_status <> 'completada' then raise exception 'El pedido no está activo'; end if;
  if v_fs in ('despachado', 'entregado') then raise exception 'No se puede editar un pedido ya despachado o entregado'; end if;
  if v_channel in ('cambio', 'tiendanube') then raise exception 'Este pedido no se puede editar (cambio o TiendaNube)'; end if;

  -- Pagos REALES en caja (todo medio que no sea cuenta corriente): no se pueden
  -- re-derivar sin descuadrar. Las cobranzas (receipt_allocations) sí se conservan.
  if exists (
    select 1 from public.sale_payments sp
    join public.payment_methods pm on pm.id = sp.payment_method_id
    where sp.sale_id = p_sale_id and coalesce(pm.kind, '') <> 'cuenta_corriente' and sp.amount > 0
  ) then
    raise exception 'El pedido tiene pagos en caja (efectivo/tarjeta u otro medio). Revertí esos pagos antes de editar.';
  end if;

  -- ── REVERT: liberar la reserva de los ítems actuales ──
  for v_it in select variant_id, quantity from public.sale_items where sale_id = p_sale_id
  loop
    update public.stock set reserved = greatest(coalesce(reserved,0) - v_it.quantity, 0), updated_at = now()
      where warehouse_id = v_wh and variant_id = v_it.variant_id;
  end loop;
  delete from public.sale_items where sale_id = p_sale_id;

  -- ── RE-APLICAR: nuevos ítems (reserva + validación de disponible) ──
  for v_el in select e from jsonb_array_elements(p_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then continue; end if;

    insert into public.sale_items (sale_id, variant_id, product_name, variant_label, quantity, unit_price, line_total)
    values (p_sale_id, v_variant, v_el->>'product_name', nullif(v_el->>'variant_label',''),
            v_qty, (v_el->>'unit_price')::numeric, v_qty * (v_el->>'unit_price')::numeric);

    select quantity, reserved into v_have, v_res from public.stock
      where warehouse_id = v_wh and variant_id = v_variant for update;
    if coalesce(v_have,0) - coalesce(v_res,0) < v_qty then
      raise exception 'Sin stock disponible de "%" (disponible %, se piden %)',
        coalesce(nullif(v_el->>'product_name',''), 'producto') || coalesce(' ' || nullif(v_el->>'variant_label',''), ''),
        coalesce(v_have,0) - coalesce(v_res,0), v_qty;
    end if;
    update public.stock set reserved = coalesce(reserved,0) + v_qty, updated_at = now()
      where warehouse_id = v_wh and variant_id = v_variant;

    v_subtotal := v_subtotal + v_qty * (v_el->>'unit_price')::numeric;
  end loop;

  if v_subtotal <= 0 then raise exception 'El pedido no tiene ítems válidos'; end if;

  -- Cupón: recalcula el descuento sobre el nuevo subtotal (no re-incrementa el uso).
  if v_coupon is not null then
    select * into c from public.coupons where id = v_coupon and organization_id = v_org;
    if found then
      if c.discount_type = 'percent' then v_discount := round(v_subtotal * c.discount_value / 100);
      else v_discount := c.discount_value; end if;
      if v_discount > v_subtotal then v_discount := v_subtotal; end if;
    end if;
  end if;
  v_new_total := v_subtotal - v_discount;

  -- #5: no dejar el total por debajo de lo ya cobrado por recibos vivos (si no,
  -- paid_amount quedaría mayor al total y la allocation colgaría sobre un total menor).
  select coalesce(sum(ra.amount), 0) into v_alloc
    from public.receipt_allocations ra
    join public.receipts r on r.id = ra.receipt_id
    where ra.sale_id = p_sale_id and r.status <> 'anulada';
  if v_new_total < v_alloc - 0.01 then
    raise exception 'El pedido ya tiene $% cobrados. No lo podés dejar por debajo de eso: anulá o ajustá la cobranza primero.',
      to_char(v_alloc, 'FM999999990.00');
  end if;

  -- ── Cuenta corriente: ajustar el saldo por la diferencia de total ──
  v_delta := v_new_total - coalesce(v_old_total, 0);
  if v_customer is not null and v_delta <> 0 then
    update public.customers set balance = balance + v_delta where id = v_customer;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_customer, v_delta, 'ajuste', 'sale', p_sale_id, auth.uid());
  end if;

  -- Rehacer el registro de pago fiado (cuenta corriente) por el nuevo total.
  delete from public.sale_payments where sale_id = p_sale_id;
  if v_customer is not null then
    select id into v_cc_method from public.payment_methods where organization_id = v_org and kind = 'cuenta_corriente' limit 1;
    if v_cc_method is not null then
      insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
      values (p_sale_id, v_cc_method, v_new_total, 0);
    end if;
  end if;

  update public.sales set
    subtotal = v_subtotal, discount = v_discount, total = v_new_total,
    paid_amount = (
      select coalesce(sum(ra.amount), 0)
      from public.receipt_allocations ra
      join public.receipts r on r.id = ra.receipt_id
      where ra.sale_id = p_sale_id and r.status <> 'anulada'
    ),
    fulfillment_status = 'pendiente'
  where id = p_sale_id;
end $$;

notify pgrst, 'reload schema';
