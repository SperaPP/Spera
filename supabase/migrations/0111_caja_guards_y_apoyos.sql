-- 0111_caja_guards_y_apoyos.sql — auditoría de sistema #1 (caja) y #6.
--
-- #1  open_cash_session / close_cash_session no validaban permiso en la base (solo la
--     UI con requireCan). Ahora exigen has_perm('caja') (null-safe: el service-role
--     pasa). open_cash_session además valida que el local sea de la organización.
-- #6  El efectivo de las cajas de APOYO se sumaba al titular con `opened_at >= apertura`
--     SIN tope superior → al corregir un cierre viejo, absorbía los apoyos de turnos
--     POSTERIORES e inflaba el esperado/diferencia. Ahora se acota al próximo turno
--     titular del local (los apoyos de después son de ese otro turno).
-- Carrera: índice único parcial → no puede haber dos cajas titulares abiertas por local.
-- Cuerpos tomados de su versión vigente (open 0030, close 0088, correct 0089).
-- Append-only e idempotente.

-- ── Una sola caja titular abierta por local (anti-carrera de apertura) ──
create unique index if not exists cash_one_titular_abierta
  on public.cash_sessions (store_id)
  where status = 'abierta' and role = 'titular';

-- ── open_cash_session: guard 'caja' + local de la org ────────
create or replace function public.open_cash_session(p_store_id uuid)
returns uuid language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_id uuid; v_role text; v_opening numeric; v_is_titular boolean;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if auth.uid() is not null and not public.has_perm('caja', true) then
    raise exception 'No tenés permiso de caja';
  end if;
  if not exists (select 1 from public.stores where id = p_store_id and organization_id = v_org) then
    raise exception 'Local inválido';
  end if;
  if exists (select 1 from public.cash_sessions where organization_id = v_org and opened_by = auth.uid() and status = 'abierta') then
    raise exception 'Ya tenés una caja abierta. Cerrala antes de abrir otra.';
  end if;

  if exists (select 1 from public.cash_sessions where store_id = p_store_id and status = 'abierta' and role = 'titular') then
    -- Ya hay titular abierta: esta caja ayuda a vender.
    v_role := 'apoyo'; v_opening := 0;
  else
    -- No hay titular abierta: solo un cajero titular puede abrirla.
    select coalesce(is_cash_titular, false) into v_is_titular from public.profiles where id = auth.uid();
    if not coalesce(v_is_titular, false) then
      raise exception 'No hay una caja titular abierta. Esperá a que la abra un cajero titular.';
    end if;
    v_role := 'titular';
    select coalesce(balance, 0) into v_opening from public.store_petty where store_id = p_store_id;
    v_opening := coalesce(v_opening, 0);
  end if;

  insert into public.cash_sessions (organization_id, store_id, opening_amount, role, opened_by)
  values (v_org, p_store_id, v_opening, v_role, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- ── close_cash_session: guard 'caja' + apoyos acotados al turno ──
create or replace function public.close_cash_session(
  p_session_id uuid, p_declared_amount numeric, p_kept_amount numeric,
  p_expenses numeric, p_notes text
) returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_store uuid; v_role text; v_to_safe numeric;
  v_opening numeric; v_opened_at timestamptz; v_own_cash numeric; v_apoyo_cash numeric := 0;
  v_expenses numeric := greatest(coalesce(p_expenses, 0), 0);
  v_expected numeric; v_diff numeric; v_next_titular timestamptz;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if auth.uid() is not null and not public.has_perm('caja', true) then
    raise exception 'No tenés permiso de caja';
  end if;
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

  -- #6: los apoyos de este turno son los abiertos entre esta apertura y el PRÓXIMO
  -- turno titular del local (si hubiera uno posterior).
  select min(opened_at) into v_next_titular from public.cash_sessions
    where store_id = v_store and role = 'titular' and opened_at > v_opened_at;

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
    where ap.store_id = v_store and ap.role = 'apoyo'
      and ap.opened_at >= v_opened_at
      and (v_next_titular is null or ap.opened_at < v_next_titular)
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

-- ── correct_cash_session: #6 apoyos acotados al turno ────────
create or replace function public.correct_cash_session(
  p_session_id uuid, p_declared numeric, p_kept numeric, p_expenses numeric, p_notes text
) returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_store uuid; v_role text; v_status text;
  v_opening numeric; v_opened_at timestamptz; v_own_cash numeric; v_apoyo_cash numeric := 0;
  v_expenses numeric := greatest(coalesce(p_expenses, 0), 0);
  v_expected numeric; v_diff numeric; v_to_safe numeric; v_old_to_safe numeric; v_is_latest boolean;
  v_next_titular timestamptz;
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

  v_own_cash :=
      coalesce((select sum(sp.amount) from public.sale_payments sp
                join public.sales s on s.id = sp.sale_id
                join public.payment_methods pm on pm.id = sp.payment_method_id
                where s.cash_session_id = p_session_id and s.status = 'completada' and pm.affects_cash), 0)
    + coalesce((select sum(rp.amount) from public.receipt_payments rp
                join public.receipts r on r.id = rp.receipt_id
                join public.payment_methods pm on pm.id = rp.payment_method_id
                where r.cash_session_id = p_session_id and r.status <> 'anulada' and pm.affects_cash), 0);

  -- #6: acotar los apoyos a ESTE turno (hasta el próximo titular del local).
  select min(opened_at) into v_next_titular from public.cash_sessions
    where store_id = v_store and role = 'titular' and opened_at > v_opened_at;

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
    where ap.store_id = v_store and ap.role = 'apoyo'
      and ap.opened_at >= v_opened_at
      and (v_next_titular is null or ap.opened_at < v_next_titular)
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

notify pgrst, 'reload schema';
