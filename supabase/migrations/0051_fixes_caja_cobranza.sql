-- 0051_fixes_caja_cobranza.sql — Endurecimiento caja + reversa de cobranza.
--
-- · Locks de concurrencia: close_cash_session / adjust_cash / deliver_to_central
--   bloquean la fila de caja chica/fuerte antes de modificarla (evita lost update
--   y que la caja fuerte quede negativa por entregas/cierres simultáneos).
-- · cancel_receipt (nuevo): revertir una cobranza mal cargada (repone saldo,
--   deshace la imputación a pedidos, marca la cobranza anulada). Solo admin (gate
--   en la server action).
-- · create_receipt rechaza medios que no son dinero real (cuenta corriente / saldo
--   a favor / cambio) en una cobranza.
-- Append-only e idempotente.

alter table public.receipts add column if not exists status text not null default 'activa';

-- ── close_cash_session: lock de caja chica/fuerte del local ───────────────────
create or replace function public.close_cash_session(p_session_id uuid, p_declared_amount numeric, p_kept_amount numeric, p_notes text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_store uuid; v_role text; v_to_safe numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select store_id, role into v_store, v_role from public.cash_sessions
    where id = p_session_id and organization_id = v_org and status = 'abierta' for update;
  if not found then raise exception 'Turno no encontrado o ya cerrado'; end if;

  if v_role = 'apoyo' then
    update public.cash_sessions set status = 'cerrada', declared_amount = p_declared_amount,
      notes = p_notes, closed_by = auth.uid(), closed_at = now() where id = p_session_id;
    return;
  end if;

  if exists (select 1 from public.cash_sessions where store_id = v_store and status = 'abierta' and role = 'apoyo') then
    raise exception 'Cerrá primero las cajas de apoyo del local';
  end if;
  if p_kept_amount < 0 then raise exception 'La caja chica no puede ser negativa'; end if;
  if p_kept_amount > p_declared_amount then raise exception 'La caja chica no puede superar el efectivo contado'; end if;

  -- Lock de las cajas del local para serializar contra adjust_cash/deliver_to_central.
  perform 1 from public.store_petty where store_id = v_store for update;
  perform 1 from public.store_safe where store_id = v_store for update;

  v_to_safe := p_declared_amount - p_kept_amount;
  update public.cash_sessions set status = 'cerrada', declared_amount = p_declared_amount,
    kept_amount = p_kept_amount, to_safe_amount = v_to_safe, notes = p_notes,
    closed_by = auth.uid(), closed_at = now() where id = p_session_id;

  insert into public.store_petty (organization_id, store_id, balance)
  values (v_org, v_store, p_kept_amount)
  on conflict (store_id) do update set balance = p_kept_amount, updated_at = now();

  if v_to_safe <> 0 then
    insert into public.store_safe (organization_id, store_id, balance)
    values (v_org, v_store, v_to_safe)
    on conflict (store_id) do update set balance = store_safe.balance + v_to_safe, updated_at = now();
  end if;
end; $$;

-- ── adjust_cash: lock de la caja destino ──────────────────────────────────────
create or replace function public.adjust_cash(p_store_id uuid, p_target text, p_delta numeric, p_reason text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
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

-- ── deliver_to_central: lock de la caja fuerte (evita negativo por TOCTOU) ─────
create or replace function public.deliver_to_central(p_store_id uuid, p_amount numeric, p_notes text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_bal numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_amount <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  select balance into v_bal from public.store_safe where store_id = p_store_id and organization_id = v_org for update;
  if coalesce(v_bal, 0) < p_amount then raise exception 'La caja fuerte no tiene ese monto (hay %)', coalesce(v_bal,0); end if;
  update public.store_safe set balance = balance - p_amount, updated_at = now() where store_id = p_store_id;
  insert into public.central_deliveries (organization_id, store_id, amount, notes, delivered_by)
  values (v_org, p_store_id, p_amount, nullif(trim(coalesce(p_notes,'')),''), auth.uid());
end; $$;

-- ── create_receipt: rechaza medios que no son dinero real ─────────────────────
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

  -- Una cobranza es dinero real; no se paga con cuenta corriente / saldo a favor / cambio.
  if exists (
    select 1 from jsonb_array_elements(p_payments) e
    join public.payment_methods pm on pm.id = (e->>'payment_method_id')::uuid
    where pm.kind in ('cuenta_corriente', 'saldo_favor', 'cambio')
  ) then
    raise exception 'Medio de pago inválido para una cobranza (no es dinero real)';
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

-- ── cancel_receipt: revertir una cobranza (repone saldo, deshace imputación) ───
create or replace function public.cancel_receipt(p_receipt_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_customer uuid; v_total numeric; v_al record;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select customer_id, total into v_customer, v_total from public.receipts
    where id = p_receipt_id and organization_id = v_org and status <> 'anulada' for update;
  if not found then raise exception 'Cobranza no encontrada o ya anulada'; end if;

  -- Deshacer la imputación a pedidos (baja el paid_amount que había subido).
  for v_al in select sale_id, amount from public.receipt_allocations where receipt_id = p_receipt_id
  loop
    update public.sales set paid_amount = greatest(paid_amount - v_al.amount, 0) where id = v_al.sale_id;
  end loop;

  -- Reponer el saldo del cliente (la cobranza había restado el total).
  if v_customer is not null then
    update public.customers set balance = balance + v_total where id = v_customer;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_customer, v_total, 'anulacion', 'receipt', p_receipt_id, auth.uid());
  end if;

  update public.receipts set status = 'anulada' where id = p_receipt_id;
end; $$;
