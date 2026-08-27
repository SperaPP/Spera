-- 0066_fixes_transfer_cobranza.sql — fixes de la auditoría (transferencias + cobranza).
--
--  · receive_transfer: faltaba FOR UPDATE → recibir dos veces (doble clic) duplicaba
--    el stock en destino. Con el lock, la 2da ejecución ve 'recibida' y falla.
--  · create_receipt: una cobranza en efectivo con caja nula/cerrada/de otro local
--    quedaba fuera del arqueo (efectivo invisible). Ahora exige caja abierta del
--    mismo local si algún medio suma a caja; y rechaza montos no positivos.
-- Append-only e idempotente.

-- ── receive_transfer con lock ─────────────────────────────────────────────────
create or replace function public.receive_transfer(p_transfer_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_to uuid; v_it record;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select to_warehouse_id into v_to from public.stock_transfers
    where id = p_transfer_id and organization_id = v_org and status = 'enviada'
    for update;   -- serializa recepciones concurrentes (anti doble-recepción)
  if not found then raise exception 'Transferencia no encontrada o ya recibida'; end if;

  for v_it in select variant_id, quantity from public.stock_transfer_items where transfer_id = p_transfer_id
  loop
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, v_to, v_it.variant_id, v_it.quantity)
    on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + v_it.quantity, updated_at = now();

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_to, v_it.variant_id, v_it.quantity, 'transferencia', 'transfer', p_transfer_id, auth.uid());
  end loop;

  update public.stock_transfers set status = 'recibida', received_at = now(), received_by = auth.uid()
    where id = p_transfer_id;
end; $$;

-- ── create_receipt: validar caja + montos ─────────────────────────────────────
create or replace function public.create_receipt(
  p_customer        uuid,
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_payments        jsonb,
  p_allocations     jsonb,
  p_notes           text
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_receipt uuid; v_total numeric := 0; v_alloc_total numeric := 0; v_el jsonb;
  v_sale uuid; v_amt numeric; v_remaining numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_payments is null or jsonb_array_length(p_payments) = 0 then raise exception 'La cobranza no tiene medios de pago'; end if;

  -- Ningún monto puede ser cero o negativo (defensa en profundidad).
  if exists (select 1 from jsonb_array_elements(p_payments) e where coalesce((e->>'amount')::numeric, 0) <= 0) then
    raise exception 'Los montos de la cobranza deben ser positivos';
  end if;

  -- Una cobranza es dinero real; no se paga con cuenta corriente / saldo a favor / cambio.
  if exists (
    select 1 from jsonb_array_elements(p_payments) e
    join public.payment_methods pm on pm.id = (e->>'payment_method_id')::uuid
    where pm.kind in ('cuenta_corriente', 'saldo_favor', 'cambio')
  ) then
    raise exception 'Medio de pago inválido para una cobranza (no es dinero real)';
  end if;

  -- Si algún medio suma al arqueo, exigir una caja ABIERTA del mismo local (si no,
  -- el efectivo cobrado quedaría fuera de todo arqueo).
  if exists (
    select 1 from jsonb_array_elements(p_payments) e
    join public.payment_methods pm on pm.id = (e->>'payment_method_id')::uuid
    where pm.affects_cash
  ) then
    if p_cash_session_id is null then
      raise exception 'La cobranza con efectivo necesita una caja abierta';
    end if;
    if not exists (
      select 1 from public.cash_sessions
      where id = p_cash_session_id and organization_id = v_org
        and store_id = p_store_id and status = 'abierta'
    ) then
      raise exception 'La caja indicada no está abierta o no pertenece a este local';
    end if;
  end if;

  select coalesce(sum((e->>'amount')::numeric), 0) into v_total from jsonb_array_elements(p_payments) e;
  if v_total <= 0 then raise exception 'El monto a cobrar debe ser mayor a cero'; end if;

  select coalesce(sum((e->>'amount')::numeric), 0) into v_alloc_total
    from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) e;
  if v_alloc_total > v_total + 0.01 then raise exception 'Estás imputando a pedidos más de lo que cobrás'; end if;

  insert into public.receipts (organization_id, customer_id, store_id, cash_session_id, total, notes, created_by)
  values (v_org, p_customer, p_store_id, p_cash_session_id, v_total, nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  returning id into v_receipt;

  for v_el in select e from jsonb_array_elements(p_payments) as e
  loop
    insert into public.receipt_payments (receipt_id, payment_method_id, amount)
    values (v_receipt, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric);
  end loop;

  for v_el in select e from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) as e
  loop
    v_sale := (v_el->>'sale_id')::uuid;
    v_amt := (v_el->>'amount')::numeric;
    if v_amt is null or v_amt <= 0 then continue; end if;
    select (total - paid_amount) into v_remaining from public.sales
      where id = v_sale and organization_id = v_org and customer_id = p_customer and status = 'completada' for update;
    if v_remaining is null then raise exception 'Pedido a imputar inválido'; end if;
    if v_amt > v_remaining + 0.01 then raise exception 'Imputás a un pedido más de lo que debe'; end if;
    update public.sales set paid_amount = paid_amount + v_amt where id = v_sale;
    insert into public.receipt_allocations (receipt_id, sale_id, amount) values (v_receipt, v_sale, v_amt);
  end loop;

  update public.customers set balance = balance - v_total where id = p_customer;
  insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
  values (v_org, p_customer, -v_total, 'cobranza', 'receipt', v_receipt, auth.uid());

  return v_receipt;
end; $$;
