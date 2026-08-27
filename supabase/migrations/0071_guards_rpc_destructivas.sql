-- 0071_guards_rpc_destructivas.sql — control de rol dentro de las RPC restantes.
--
-- Cierra el hallazgo 3 de la auditoria: estas RPC solo validaban organizacion, asi
-- que un usuario podia invocarlas por API directa saltando el guard de la UI. Ahora
-- cada una exige el permiso adecuado (has_perm / is_admin), coherente con la matriz
-- de roles (0037). Cuerpos extraidos de su version vigente + el chequeo tras begin.
-- Append-only e idempotente.

create or replace function public.cancel_receipt(p_receipt_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_customer uuid; v_total numeric; v_al record;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede anular cobranzas'; end if;
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;

  select customer_id, total into v_customer, v_total from public.receipts
    where id = p_receipt_id and organization_id = v_org and status <> 'anulada' for update;
  if not found then raise exception 'Cobranza no encontrada o ya anulada'; end if;

  -- Si pagó un pedido que ya se despachó, no se puede anular (la mercadería salió).
  if exists (
    select 1 from public.receipt_allocations ra
    join public.sales s on s.id = ra.sale_id
    where ra.receipt_id = p_receipt_id and s.fulfillment_status = 'despachado'
  ) then
    raise exception 'Esta cobranza pagó un pedido que ya fue despachado; no se puede anular.';
  end if;

  for v_al in select sale_id, amount from public.receipt_allocations where receipt_id = p_receipt_id
  loop
    update public.sales set paid_amount = greatest(paid_amount - v_al.amount, 0) where id = v_al.sale_id;
  end loop;

  if v_customer is not null then
    update public.customers set balance = balance + v_total where id = v_customer;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_customer, v_total, 'anulacion', 'receipt', p_receipt_id, auth.uid());
  end if;

  update public.receipts set status = 'anulada' where id = p_receipt_id;
end; $$;

create or replace function public.cancel_transfer(p_transfer_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_from uuid; v_status text; v_it record;
begin
  if not public.has_perm('transferencias', true) then raise exception 'No tenes permiso para cancelar transferencias'; end if;
  if v_org is null then raise exception 'Sin organización'; end if;
  select from_warehouse_id, status into v_from, v_status from public.stock_transfers
    where id = p_transfer_id and organization_id = v_org and status in ('creada', 'enviada') for update;
  if not found then raise exception 'Transferencia no encontrada o ya recibida/cancelada'; end if;

  -- Solo si ya estaba enviada hay stock que reponer en el origen.
  if v_status = 'enviada' then
    for v_it in select variant_id, quantity from public.stock_transfer_items where transfer_id = p_transfer_id
    loop
      update public.stock set quantity = quantity + v_it.quantity, updated_at = now()
      where warehouse_id = v_from and variant_id = v_it.variant_id;
      insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_from, v_it.variant_id, v_it.quantity, 'transferencia_cancel', 'transfer', p_transfer_id, auth.uid());
    end loop;
  end if;

  update public.stock_transfers set status = 'cancelada' where id = p_transfer_id;
end; $$;

create or replace function public.adjust_cash(p_store_id uuid, p_target text, p_delta numeric, p_reason text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  if not public.has_perm('caja_admin', true) then raise exception 'No tenes permiso para ajustar la caja'; end if;
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_target = 'chica' then
    perform 1 from public.store_petty where store_id = p_store_id for update;
    insert into public.store_petty (organization_id, store_id, balance) values (v_org, p_store_id, p_delta)
    on conflict (store_id) do update set balance = store_petty.balance + p_delta, updated_at = now();
  elsif p_target = 'fuerte' then
    perform 1 from public.store_safe where store_id = p_store_id for update;
    insert into public.store_safe (organization_id, store_id, balance) values (v_org, p_store_id, p_delta)
    on conflict (store_id) do update set balance = store_safe.balance + p_delta, updated_at = now();
  else
    raise exception 'Destino de ajuste inválido';
  end if;
  insert into public.cash_adjustments (organization_id, store_id, target, delta, reason, created_by)
  values (v_org, p_store_id, p_target, p_delta, nullif(trim(coalesce(p_reason,'')),''), auth.uid());
end; $$;

create or replace function public.deliver_to_central(p_store_id uuid, p_amount numeric, p_notes text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_bal numeric;
begin
  if not public.has_perm('caja', true) then raise exception 'No tenes permiso de caja'; end if;
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_amount <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  select balance into v_bal from public.store_safe where store_id = p_store_id and organization_id = v_org for update;
  if coalesce(v_bal, 0) < p_amount then raise exception 'La caja fuerte no tiene ese monto (hay %)', coalesce(v_bal,0); end if;
  update public.store_safe set balance = balance - p_amount, updated_at = now() where store_id = p_store_id;
  insert into public.central_deliveries (organization_id, store_id, amount, notes, delivered_by)
  values (v_org, p_store_id, p_amount, nullif(trim(coalesce(p_notes,'')),''), auth.uid());
end; $$;

create or replace function public.create_transfer(
  p_from  uuid,
  p_to    uuid,
  p_items jsonb,
  p_notes text
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_transfer uuid; v_el jsonb; v_variant uuid; v_qty integer; v_have integer; v_res integer;
begin
  if not public.has_perm('transferencias', true) then raise exception 'No tenes permiso para crear transferencias'; end if;
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_from = p_to then raise exception 'El origen y el destino no pueden ser el mismo depósito'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La transferencia no tiene ítems'; end if;

  insert into public.stock_transfers (organization_id, from_warehouse_id, to_warehouse_id, status, notes, created_by)
  values (v_org, p_from, p_to, 'creada', nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  returning id into v_transfer;

  for v_el in select e from jsonb_array_elements(p_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;

    -- Factibilidad al crear (no descuenta; el stock sale recién al enviar).
    select quantity, reserved into v_have, v_res from public.stock where warehouse_id = p_from and variant_id = v_variant;
    if coalesce(v_have,0) - coalesce(v_res,0) < v_qty then
      raise exception 'Stock disponible insuficiente en el origen para % (disponible %, se piden %)',
        v_el->>'product_name', coalesce(v_have,0) - coalesce(v_res,0), v_qty;
    end if;

    insert into public.stock_transfer_items (transfer_id, variant_id, quantity)
    values (v_transfer, v_variant, v_qty);
  end loop;

  return v_transfer;
end; $$;

create or replace function public.dispatch_sale(
  p_sale_id uuid, p_shipping_method_id uuid, p_tracking text, p_notes text
) returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_it record; v_have numeric; v_total numeric; v_paid numeric;
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
    select quantity into v_have from public.stock where warehouse_id = v_wh and variant_id = v_it.variant_id for update;
    if coalesce(v_have,0) < v_it.quantity then
      raise exception 'No hay stock físico para despachar una de las prendas';
    end if;
    update public.stock set quantity = v_have - v_it.quantity,
                            reserved = greatest(coalesce(reserved,0) - v_it.quantity, 0),
                            updated_at = now()
      where warehouse_id = v_wh and variant_id = v_it.variant_id;
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_wh, v_it.variant_id, -v_it.quantity, 'despacho', 'sale', p_sale_id, auth.uid());
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

