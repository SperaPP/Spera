-- 0122_saldo_favor_solo_deuda.sql — create_receipt: el saldo a favor disponible se calcula
-- igual que en la pantalla de cobranza (suma solo lo que los pedidos DEBEN).
--
-- Bug (caso Stella Dono, 11/11/2026): un pedido editado a la baja después de cobrarlo (antes
-- del guard de 0109) quedó con paid_amount > total. La pantalla mostraba $6.050 a favor, pero
-- el servidor restaba ese "pagado de más" y daba "disponible 0" al aplicarlo.
-- La causa raíz ya está bloqueada (0109: edit_sale no deja bajar por debajo de lo cobrado);
-- esto alinea el cálculo para que nunca más difieran. Único cambio: greatest(…, 0).
--
-- Append-only e idempotente. Correr A MANO en el SQL Editor de Supabase.

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
  if auth.uid() is not null and not public.has_perm('cobranzas', true) then
    raise exception 'No tenés permiso para registrar cobranzas';
  end if;
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
    -- 0122: solo lo que se DEBE (un pedido pagado de más no resta: si no, el saldo a favor
    -- que muestra la pantalla de cobranza no se podía aplicar → "disponible 0").
    select coalesce(sum(greatest(total - paid_amount, 0)), 0) into v_unpaid
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

  -- Solo el dinero REAL baja el saldo de cuenta corriente.
  if v_real > 0 then
    update public.customers set balance = balance - v_real where id = p_customer;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, p_customer, -v_real, 'cobranza', 'receipt', v_receipt, auth.uid());
  end if;

  return v_receipt;
end; $$;

notify pgrst, 'reload schema';
