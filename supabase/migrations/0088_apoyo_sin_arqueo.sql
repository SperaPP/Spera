-- 0088_apoyo_sin_arqueo.sql — la caja de APOYO cierra sin arqueo.
--
-- Nuevo comportamiento: el vendedor de apoyo cobra (queda registrado a su nombre),
-- pero su efectivo se rinde automáticamente a la caja TITULAR. Por eso, al cerrar,
-- al apoyo NO se le pide efectivo contado/esperado ni se calcula diferencia: cierra
-- y listo. El único arqueo del local lo hace el titular, que ya consolida el
-- efectivo cobrado por sus cajas de apoyo. La rama titular queda igual que 0078.
-- Append-only e idempotente.

create or replace function public.close_cash_session(
  p_session_id uuid, p_declared_amount numeric, p_kept_amount numeric,
  p_expenses numeric, p_notes text
) returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_store uuid; v_role text; v_to_safe numeric;
  v_opening numeric; v_opened_at timestamptz; v_own_cash numeric; v_apoyo_cash numeric := 0;
  v_expenses numeric := greatest(coalesce(p_expenses, 0), 0);
  v_expected numeric; v_diff numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if v_expenses < 0 then raise exception 'Los gastos en efectivo no pueden ser negativos'; end if;

  select store_id, role, opening_amount, opened_at
    into v_store, v_role, v_opening, v_opened_at
  from public.cash_sessions where id = p_session_id and organization_id = v_org and status = 'abierta' for update;
  if not found then raise exception 'Turno no encontrado o ya cerrado'; end if;

  -- ── Apoyo: cierra SIN arqueo (su efectivo se rinde a la caja titular) ──
  if v_role = 'apoyo' then
    update public.cash_sessions set status = 'cerrada',
      declared_amount = null, cash_expenses = 0, expected_cash = null, cash_difference = null,
      notes = p_notes, closed_by = auth.uid(), closed_at = now() where id = p_session_id;
    return;
  end if;

  -- ── Titular: arqueo del local (consolida el efectivo de sus apoyos) ──
  -- Efectivo propio del turno: ventas + cobranzas que afectan caja.
  v_own_cash :=
      coalesce((select sum(sp.amount) from public.sale_payments sp
                join public.sales s on s.id = sp.sale_id
                join public.payment_methods pm on pm.id = sp.payment_method_id
                where s.cash_session_id = p_session_id and s.status = 'completada' and pm.affects_cash), 0)
    + coalesce((select sum(rp.amount) from public.receipt_payments rp
                join public.receipts r on r.id = rp.receipt_id
                join public.payment_methods pm on pm.id = rp.payment_method_id
                where r.cash_session_id = p_session_id and r.status <> 'anulada' and pm.affects_cash), 0);

  if exists (select 1 from public.cash_sessions where store_id = v_store and status = 'abierta' and role = 'apoyo') then
    raise exception 'Cerrá primero las cajas de apoyo del local';
  end if;
  if p_kept_amount < 0 then raise exception 'La caja chica no puede ser negativa'; end if;
  if p_kept_amount > p_declared_amount then raise exception 'La caja chica no puede superar el efectivo contado'; end if;

  -- Suma el efectivo cobrado por las cajas de apoyo del turno (se rinde al titular).
  select coalesce(sum(x.c), 0) into v_apoyo_cash from (
    select coalesce((select sum(sp.amount) from public.sale_payments sp
                     join public.sales s2 on s2.id = sp.sale_id
                     join public.payment_methods pm on pm.id = sp.payment_method_id
                     where s2.cash_session_id = ap.id and s2.status = 'completada' and pm.affects_cash), 0)
         + coalesce((select sum(rp.amount) from public.receipt_payments rp
                     join public.receipts r on r.id = rp.receipt_id
                     join public.payment_methods pm on pm.id = rp.payment_method_id
                     where r.cash_session_id = ap.id and r.status <> 'anulada' and pm.affects_cash), 0) as c
    from public.cash_sessions ap
    where ap.store_id = v_store and ap.role = 'apoyo' and ap.opened_at >= v_opened_at
  ) x;

  v_expected := coalesce(v_opening,0) + v_own_cash + v_apoyo_cash - v_expenses;
  v_diff := p_declared_amount - v_expected;

  perform 1 from public.store_petty where store_id = v_store for update;
  perform 1 from public.store_safe where store_id = v_store for update;

  v_to_safe := p_declared_amount - p_kept_amount;
  update public.cash_sessions set status = 'cerrada', declared_amount = p_declared_amount,
    kept_amount = p_kept_amount, to_safe_amount = v_to_safe, cash_expenses = v_expenses,
    expected_cash = v_expected, cash_difference = v_diff,
    notes = p_notes, closed_by = auth.uid(), closed_at = now() where id = p_session_id;

  insert into public.store_petty (organization_id, store_id, balance)
  values (v_org, v_store, p_kept_amount)
  on conflict (store_id) do update set balance = p_kept_amount, updated_at = now();

  if v_to_safe <> 0 then
    insert into public.store_safe (organization_id, store_id, balance)
    values (v_org, v_store, v_to_safe)
    on conflict (store_id) do update set balance = public.store_safe.balance + v_to_safe, updated_at = now();
  end if;
end; $$;
