-- 0081_editar_pedido.sql — edición de un pedido MAYORISTA aún no controlado.
--
-- Permite cambiar ítems/cantidades de un pedido en estado 'pendiente' (mayorista/
-- portal), revirtiendo y re-aplicando sus efectos en una sola transacción:
--   • Stock: libera la reserva de los ítems viejos y reserva los nuevos.
--   • Cuenta corriente: ajusta el saldo del cliente por la diferencia de total.
--   • Cupón: recalcula el descuento sobre el nuevo subtotal (no re-cuenta el uso).
--   • sale_items / sale_payments / totales: se rehacen.
--
-- Reglas de seguridad:
--   • Solo admin.
--   • Solo status='completada' y fulfillment_status='pendiente' (antes de controlar).
--   • No 'cambio' ni 'tiendanube' (este último desincronizaría el stock de TN).
--   • Solo pedidos 100% en cuenta corriente / sin cobrar: paid_amount = 0 y sin
--     cobranzas imputadas (receipt_allocations). Si ya se cobró, hay que revertir
--     la cobranza antes de editar (evita descuadres de caja/cta cte).
--
-- Append-only e idempotente.

create or replace function public.edit_sale(p_sale_id uuid, p_items jsonb)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_customer uuid; v_coupon uuid; v_channel text; v_fs text; v_status text;
  v_old_total numeric; v_paid numeric;
  v_subtotal numeric := 0; v_discount numeric := 0; v_new_total numeric := 0; v_delta numeric;
  c record; v_el jsonb; v_variant uuid; v_qty integer; v_have numeric; v_res numeric;
  v_cc_method uuid; v_it record;
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
  if v_fs <> 'pendiente' then raise exception 'Solo se puede editar un pedido pendiente (todavía sin controlar)'; end if;
  if v_channel in ('cambio', 'tiendanube') then raise exception 'Este pedido no se puede editar (cambio o TiendaNube)'; end if;

  -- Solo pedidos sin cobrar (100% cuenta corriente): evita descuadrar pagos/cobranzas.
  if coalesce(v_paid, 0) <> 0 then
    raise exception 'El pedido ya tiene pagos cobrados; revertí la cobranza antes de editar';
  end if;
  if exists (select 1 from public.receipt_allocations where sale_id = p_sale_id) then
    raise exception 'El pedido ya tiene una cobranza imputada; revertila antes de editar';
  end if;

  -- ── REVERT: liberar la reserva de los ítems actuales (pendiente ⇒ reservado) ──
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

  -- ── Cuenta corriente: ajustar el saldo por la diferencia (el pedido es 100% fiado) ──
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

  update public.sales set subtotal = v_subtotal, discount = v_discount, total = v_new_total, paid_amount = 0
    where id = p_sale_id;
end $$;
