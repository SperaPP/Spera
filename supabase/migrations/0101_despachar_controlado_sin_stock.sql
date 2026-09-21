-- 0101_despachar_controlado_sin_stock.sql — despachar un pedido controlado aunque
-- el sistema no tenga físico suficiente en ese momento.
--
-- Un pedido controlado ya fue armado/verificado físicamente (la mercadería está
-- apartada), así que al retirarlo/enviarlo debe poder pasarse a despachado aunque
-- el físico del sistema esté en 0 (p.ej. por un ajuste posterior). Antes cortaba con
-- "No hay stock físico para despachar". Ahora descuenta lo que HAYA (nunca a negativo)
-- y libera la reserva; el movimiento registra el descuento real. El resto de las
-- reglas (pago, estado controlado, lock) queda igual. Append-only e idempotente.

create or replace function public.dispatch_sale(
  p_sale_id uuid, p_shipping_method_id uuid, p_tracking text, p_notes text
) returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_it record; v_have numeric; v_res numeric; v_take numeric; v_total numeric; v_paid numeric;
begin
  if not public.has_perm('logistica', true) then raise exception 'No tenes permiso para despachar pedidos'; end if;
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_shipping_method_id is null then raise exception 'Elegí el método de despacho'; end if;

  select st.warehouse_id, s.total, s.paid_amount into v_wh, v_total, v_paid
  from public.sales s join public.stores st on st.id = s.store_id
  where s.id = p_sale_id and s.organization_id = v_org
    and s.status = 'completada' and s.fulfillment_status = 'controlado'
  for update of s;
  if v_wh is null then raise exception 'El pedido no está listo para despachar'; end if;

  if coalesce(v_paid,0) < v_total - 0.01 then
    raise exception 'El pedido no está pago. Cobralo antes de despachar (falta %).', to_char(v_total - coalesce(v_paid,0), 'FM999999990.00');
  end if;

  for v_it in select variant_id, (quantity - returned_qty) as quantity from public.sale_items
           where sale_id = p_sale_id and (quantity - returned_qty) > 0  -- despacha neto de lo devuelto
  loop
    select quantity, reserved into v_have, v_res from public.stock
      where warehouse_id = v_wh and variant_id = v_it.variant_id for update;
    if found then
      -- Descuenta lo que haya, sin ir a negativo, y libera la reserva del pedido.
      v_take := least(coalesce(v_have, 0), v_it.quantity);
      update public.stock set
        quantity = greatest(coalesce(v_have, 0) - v_it.quantity, 0),
        reserved = greatest(coalesce(v_res, 0) - v_it.quantity, 0),
        updated_at = now()
      where warehouse_id = v_wh and variant_id = v_it.variant_id;
      if v_take > 0 then
        insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
        values (v_org, v_wh, v_it.variant_id, -v_take, 'despacho', 'sale', p_sale_id, auth.uid());
      end if;
    end if;
  end loop;

  update public.sales set
    fulfillment_status = 'despachado',
    shipping_method_id = p_shipping_method_id,
    tracking = nullif(trim(coalesce(p_tracking,'')), ''),
    dispatch_notes = nullif(trim(coalesce(p_notes,'')), ''),
    dispatched_at = now(),
    dispatched_by = auth.uid()
  where id = p_sale_id;
end; $$;

notify pgrst, 'reload schema';
