-- 0089_corregir_cierre.sql — administración corrige una caja YA CERRADA.
--
-- Permite a un admin editar el efectivo contado, la caja chica, los gastos y la
-- nota de un cierre de caja titular, recalcular el esperado/diferencia y reajustar
-- las cajas chica/fuerte del local por el delta, para que el arqueo cuadre.
--   • Caja fuerte: es acumulador → se ajusta por (nuevo_a_fuerte − viejo_a_fuerte).
--   • Caja chica: se fija por cierre → solo se re-fija si este es el ÚLTIMO cierre
--     titular del local (si hay uno posterior, la caja chica le pertenece a ese).
-- El apoyo no tiene arqueo: solo se le corrige la nota.
-- Solo admin. Append-only e idempotente.

create or replace function public.correct_cash_session(
  p_session_id uuid, p_declared numeric, p_kept numeric, p_expenses numeric, p_notes text
) returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_store uuid; v_role text; v_status text;
  v_opening numeric; v_opened_at timestamptz; v_own_cash numeric; v_apoyo_cash numeric := 0;
  v_expenses numeric := greatest(coalesce(p_expenses, 0), 0);
  v_expected numeric; v_diff numeric; v_to_safe numeric; v_old_to_safe numeric; v_is_latest boolean;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not public.has_perm('caja_admin', true) then raise exception 'No tenés permiso para corregir cierres'; end if;

  select store_id, role, status, opening_amount, opened_at, coalesce(to_safe_amount, 0)
    into v_store, v_role, v_status, v_opening, v_opened_at, v_old_to_safe
  from public.cash_sessions where id = p_session_id and organization_id = v_org for update;
  if not found then raise exception 'Caja no encontrada'; end if;
  if v_status not in ('cerrada', 'entregada') then raise exception 'Solo se corrige una caja ya cerrada'; end if;

  -- Apoyo: sin arqueo, solo la nota.
  if v_role = 'apoyo' then
    update public.cash_sessions set notes = p_notes where id = p_session_id;
    return;
  end if;

  if v_expenses < 0 then raise exception 'Los gastos no pueden ser negativos'; end if;
  if p_kept < 0 then raise exception 'La caja chica no puede ser negativa'; end if;
  if p_kept > p_declared then raise exception 'La caja chica no puede superar el efectivo contado'; end if;

  -- Efectivo propio + de apoyos (recomputado: contempla anulaciones posteriores).
  v_own_cash :=
      coalesce((select sum(sp.amount) from public.sale_payments sp
                join public.sales s on s.id = sp.sale_id
                join public.payment_methods pm on pm.id = sp.payment_method_id
                where s.cash_session_id = p_session_id and s.status = 'completada' and pm.affects_cash), 0)
    + coalesce((select sum(rp.amount) from public.receipt_payments rp
                join public.receipts r on r.id = rp.receipt_id
                join public.payment_methods pm on pm.id = rp.payment_method_id
                where r.cash_session_id = p_session_id and r.status <> 'anulada' and pm.affects_cash), 0);

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

  v_expected := coalesce(v_opening, 0) + v_own_cash + v_apoyo_cash - v_expenses;
  v_diff := p_declared - v_expected;
  v_to_safe := p_declared - p_kept;

  perform 1 from public.store_petty where store_id = v_store for update;
  perform 1 from public.store_safe where store_id = v_store for update;

  -- Caja fuerte: ajustar por la diferencia de lo enviado.
  if (v_to_safe - v_old_to_safe) <> 0 then
    insert into public.store_safe (organization_id, store_id, balance)
    values (v_org, v_store, v_to_safe - v_old_to_safe)
    on conflict (store_id) do update set balance = public.store_safe.balance + (v_to_safe - v_old_to_safe), updated_at = now();
  end if;

  -- Caja chica: re-fijar solo si este es el cierre titular MÁS RECIENTE del local.
  select not exists (
    select 1 from public.cash_sessions o
    where o.store_id = v_store and o.role = 'titular' and o.status in ('cerrada', 'entregada')
      and o.closed_at > (select closed_at from public.cash_sessions where id = p_session_id)
  ) into v_is_latest;
  if v_is_latest then
    insert into public.store_petty (organization_id, store_id, balance)
    values (v_org, v_store, p_kept)
    on conflict (store_id) do update set balance = p_kept, updated_at = now();
  end if;

  update public.cash_sessions set declared_amount = p_declared, kept_amount = p_kept, to_safe_amount = v_to_safe,
    cash_expenses = v_expenses, expected_cash = v_expected, cash_difference = v_diff, notes = p_notes
  where id = p_session_id;
end $$;
