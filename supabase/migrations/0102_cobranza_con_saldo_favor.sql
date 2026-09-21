-- 0102_cobranza_con_saldo_favor.sql — usar el saldo a favor para cobrar pedidos.
--
-- Caso real: un cliente tenía 3 pedidos fiados; devolvió una prenda ($42.000) que
-- pasó a saldo a favor, y pagó el resto imputándolo a 2 pedidos → la cta cte quedó
-- en 0 pero el 3er pedido quedó SIN pago asignado (no despachable), aunque la
-- devolución ya lo cubre en el neto.
--
-- create_receipt ahora acepta el medio 'saldo_favor': imputa a los pedidos (los deja
-- cobrados) SIN mover la cuenta corriente (el a favor ya estaba neteado en el saldo).
-- El saldo a favor disponible = max(0, deuda_en_pedidos_impaga − saldo_cta_cte); no se
-- puede usar más que eso (no excederse). Solo la parte de DINERO REAL mueve el saldo.
-- cancel_receipt restaura al saldo únicamente la parte real. Se sigue rechazando
-- cuenta_corriente y cambio. Append-only e idempotente.

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
  v_real numeric := 0; v_credit numeric := 0; v_unpaid numeric := 0; v_balance numeric := 0;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_payments is null or jsonb_array_length(p_payments) = 0 then raise exception 'La cobranza no tiene medios de pago'; end if;

  if exists (select 1 from jsonb_array_elements(p_payments) e where coalesce((e->>'amount')::numeric, 0) <= 0) then
    raise exception 'Los montos de la cobranza deben ser positivos';
  end if;

  -- Cuenta corriente y cambio no pueden pagar una cobranza. Saldo a favor SÍ (abajo
  -- se trata aparte: no es dinero real, no mueve caja ni saldo).
  if exists (
    select 1 from jsonb_array_elements(p_payments) e
    join public.payment_methods pm on pm.id = (e->>'payment_method_id')::uuid
    where pm.kind in ('cuenta_corriente', 'cambio')
  ) then
    raise exception 'Medio de pago inválido para una cobranza';
  end if;

  -- Reparte el total en dinero real vs saldo a favor.
  for v_el in select e from jsonb_array_elements(p_payments) as e loop
    if exists (select 1 from public.payment_methods pm where pm.id = (v_el->>'payment_method_id')::uuid and pm.kind = 'saldo_favor') then
      v_credit := v_credit + (v_el->>'amount')::numeric;
    else
      v_real := v_real + (v_el->>'amount')::numeric;
    end if;
  end loop;

  -- Saldo a favor disponible = lo impago de sus pedidos menos lo que debe en cta cte.
  if v_credit > 0 then
    select coalesce(sum(total - paid_amount), 0) into v_unpaid
      from public.sales where organization_id = v_org and customer_id = p_customer and status = 'completada';
    select balance into v_balance from public.customers where id = p_customer and organization_id = v_org for update;
    if v_credit > greatest(0, v_unpaid - coalesce(v_balance, 0)) + 0.01 then
      raise exception 'El saldo a favor disponible no alcanza (disponible %)',
        to_char(greatest(0, v_unpaid - coalesce(v_balance, 0)), 'FM999999990.00');
    end if;
  end if;

  -- Caja abierta solo si algún medio suma al arqueo (el saldo a favor no).
  if exists (
    select 1 from jsonb_array_elements(p_payments) e
    join public.payment_methods pm on pm.id = (e->>'payment_method_id')::uuid
    where pm.affects_cash
  ) then
    if p_cash_session_id is null then raise exception 'La cobranza con efectivo necesita una caja abierta'; end if;
    if not exists (
      select 1 from public.cash_sessions
      where id = p_cash_session_id and organization_id = v_org and store_id = p_store_id and status = 'abierta'
    ) then raise exception 'La caja indicada no está abierta o no pertenece a este local'; end if;
  end if;

  v_total := v_real + v_credit;
  if v_total <= 0 then raise exception 'El monto a cobrar debe ser mayor a cero'; end if;

  select coalesce(sum((e->>'amount')::numeric), 0) into v_alloc_total
    from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) e;
  if v_alloc_total > v_total + 0.01 then raise exception 'Estás imputando a pedidos más de lo que cobrás'; end if;
  -- El saldo a favor solo tiene sentido imputado a pedidos (no deja "saldo del saldo").
  if v_credit > v_alloc_total + 0.01 then
    raise exception 'El saldo a favor tiene que imputarse a pedidos (imputá al menos %)',
      to_char(v_credit, 'FM999999990.00');
  end if;

  insert into public.receipts (organization_id, customer_id, store_id, cash_session_id, total, notes, created_by)
  values (v_org, p_customer, p_store_id, p_cash_session_id, v_total, nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  returning id into v_receipt;

  for v_el in select e from jsonb_array_elements(p_payments) as e loop
    insert into public.receipt_payments (receipt_id, payment_method_id, amount)
    values (v_receipt, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric);
  end loop;

  for v_el in select e from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) as e loop
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

  -- Solo el dinero REAL baja el saldo de cuenta corriente. El saldo a favor es
  -- balance-neutral (ya estaba neteado en el saldo cuando entró la devolución/crédito).
  if v_real > 0 then
    update public.customers set balance = balance - v_real where id = p_customer;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, p_customer, -v_real, 'cobranza', 'receipt', v_receipt, auth.uid());
  end if;

  return v_receipt;
end; $$;

-- cancel_receipt: restaurar al saldo únicamente la parte de dinero real.
create or replace function public.cancel_receipt(p_receipt_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_customer uuid; v_total numeric; v_real numeric; v_al record;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede anular cobranzas'; end if;
  perform set_config('app.cust_bal', '1', true);
  if v_org is null then raise exception 'Sin organización'; end if;

  select customer_id, total into v_customer, v_total from public.receipts
    where id = p_receipt_id and organization_id = v_org and status <> 'anulada' for update;
  if not found then raise exception 'Cobranza no encontrada o ya anulada'; end if;

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

  -- Parte de dinero real de la cobranza (lo que efectivamente había bajado el saldo).
  select coalesce(sum(rp.amount), 0) into v_real
    from public.receipt_payments rp
    join public.payment_methods pm on pm.id = rp.payment_method_id
    where rp.receipt_id = p_receipt_id and coalesce(pm.kind, '') <> 'saldo_favor';

  if v_customer is not null and v_real > 0 then
    update public.customers set balance = balance + v_real where id = v_customer;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_customer, v_real, 'anulacion', 'receipt', p_receipt_id, auth.uid());
  end if;

  update public.receipts set status = 'anulada' where id = p_receipt_id;
end; $$;

notify pgrst, 'reload schema';
