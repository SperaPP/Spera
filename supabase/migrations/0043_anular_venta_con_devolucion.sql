-- 0043_anular_venta_con_devolucion.sql — Blindaje de anulación.
--
-- Problema: cancel_sale repone sale_items.quantity ENTERO, sin mirar returned_qty.
-- Si una venta ya tuvo un cambio/devolución parcial (returned_qty > 0), anularla:
--   · repone de más el stock (mercadería fantasma), y
--   · descuadra el saldo (el cambio ya movió crédito por separado, referenciando
--     'exchange', no 'sale').
-- Resultado: se regala mercadería por los dos lados.
--
-- Fix conservador: bloquear la anulación cuando hay prendas ya devueltas. Anular
-- una venta parcialmente devuelta es ambiguo; hay que revertir el cambio primero.
-- Append-only e idempotente: redefine cancel_sale con el guard.

create or replace function public.cancel_sale(p_sale_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_customer uuid; v_coupon uuid; v_it record; v_net numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select s.customer_id, s.coupon_id, st.warehouse_id into v_customer, v_coupon, v_wh
  from public.sales s join public.stores st on st.id = s.store_id
  where s.id = p_sale_id and s.organization_id = v_org and s.status = 'completada';
  if not found then raise exception 'Venta no encontrada o ya anulada'; end if;

  -- Guard: una venta con prendas ya devueltas/cambiadas no se puede anular acá,
  -- porque el cambio ya resolvió esa parte del stock y del saldo por separado.
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
