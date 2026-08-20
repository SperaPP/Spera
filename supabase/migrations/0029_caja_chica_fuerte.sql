-- 0029_caja_chica_fuerte.sql — Efectivo: caja titular/apoyo, caja chica + caja fuerte por local.
--  Cada local tiene UNA caja chica y UNA caja fuerte (saldos continuos).
--  Sesiones por cajero, simultáneas:
--    • La PRIMERA caja abierta del local = TITULAR: arranca con la caja chica (arrastrada),
--      y en su cierre reparte cuánto queda en caja chica (se arrastra) y cuánto pasa a
--      la caja fuerte del local. Cierra al final (no puede cerrar con apoyos abiertas).
--    • Las siguientes = APOYO: abren sin fondo, sólo venden; su cierre es un arqueo simple
--      y su efectivo se consolida en la titular.
--  Administración: entrega a Casa Central (desde la fuerte) y ajustes (caja chica / fuerte).
-- Append-only e idempotente.

alter table public.cash_sessions add column if not exists role text not null default 'titular'
  check (role in ('titular', 'apoyo'));
alter table public.cash_sessions add column if not exists kept_amount   numeric(14,2);  -- titular: queda en caja chica
alter table public.cash_sessions add column if not exists to_safe_amount numeric(14,2); -- titular: pasa a caja fuerte

-- Caja chica por local.
create table if not exists public.store_petty (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  balance numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (store_id)
);
-- Caja fuerte por local.
create table if not exists public.store_safe (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  balance numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (store_id)
);
-- Ajustes de caja (administración): fondo inicial y correcciones.
create table if not exists public.cash_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  target text not null check (target in ('chica', 'fuerte')),
  delta numeric(14,2) not null,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
-- Entregas a Casa Central (desde la caja fuerte del local).
create table if not exists public.central_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  amount numeric(14,2) not null check (amount > 0),
  notes text,
  delivered_at timestamptz not null default now(),
  delivered_by uuid references auth.users(id)
);

alter table public.store_petty        enable row level security;
alter table public.store_safe         enable row level security;
alter table public.cash_adjustments   enable row level security;
alter table public.central_deliveries enable row level security;
drop policy if exists store_petty_all on public.store_petty;
create policy store_petty_all on public.store_petty for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
drop policy if exists store_safe_all on public.store_safe;
create policy store_safe_all on public.store_safe for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
drop policy if exists cash_adjustments_all on public.cash_adjustments;
create policy cash_adjustments_all on public.cash_adjustments for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
drop policy if exists central_deliveries_all on public.central_deliveries;
create policy central_deliveries_all on public.central_deliveries for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());

-- Permiso de administración de caja (entregas/ajustes) para el futuro rol Administración.
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, 'caja_admin', true, true
from public.roles r where r.name = 'SuperAdministrador'
on conflict (role_id, module) do update set can_view = true, can_edit = true;

-- ── Abrir: primera del local = titular (arrastra caja chica); resto = apoyo (sin fondo) ──
drop function if exists public.open_cash_session(uuid, numeric);
create or replace function public.open_cash_session(p_store_id uuid)
returns uuid language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_id uuid; v_role text; v_opening numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if exists (select 1 from public.cash_sessions where organization_id = v_org and opened_by = auth.uid() and status = 'abierta') then
    raise exception 'Ya tenés una caja abierta. Cerrala antes de abrir otra.';
  end if;

  if exists (select 1 from public.cash_sessions where store_id = p_store_id and status = 'abierta') then
    v_role := 'apoyo'; v_opening := 0;
  else
    v_role := 'titular';
    select coalesce(balance, 0) into v_opening from public.store_petty where store_id = p_store_id;
    v_opening := coalesce(v_opening, 0);
  end if;

  insert into public.cash_sessions (organization_id, store_id, opening_amount, role, opened_by)
  values (v_org, p_store_id, v_opening, v_role, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- ── Cerrar: apoyo = arqueo simple; titular = reparto caja chica/fuerte ──
drop function if exists public.close_cash_session(uuid, numeric, text);
drop function if exists public.close_cash_session(uuid, numeric, numeric, text);
create or replace function public.close_cash_session(p_session_id uuid, p_declared_amount numeric, p_kept_amount numeric, p_notes text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_store uuid; v_role text; v_to_safe numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select store_id, role into v_store, v_role from public.cash_sessions
    where id = p_session_id and organization_id = v_org and status = 'abierta';
  if not found then raise exception 'Turno no encontrado o ya cerrado'; end if;

  if v_role = 'apoyo' then
    update public.cash_sessions set status = 'cerrada', declared_amount = p_declared_amount,
      notes = p_notes, closed_by = auth.uid(), closed_at = now() where id = p_session_id;
    return;
  end if;

  -- Titular: no puede cerrar con cajas de apoyo abiertas.
  if exists (select 1 from public.cash_sessions where store_id = v_store and status = 'abierta' and role = 'apoyo') then
    raise exception 'Cerrá primero las cajas de apoyo del local';
  end if;
  if p_kept_amount < 0 then raise exception 'La caja chica no puede ser negativa'; end if;
  if p_kept_amount > p_declared_amount then raise exception 'La caja chica no puede superar el efectivo contado'; end if;

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

-- ── Ajuste de caja (administración): caja chica o caja fuerte del local ──
create or replace function public.adjust_cash(p_store_id uuid, p_target text, p_delta numeric, p_reason text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_target = 'chica' then
    insert into public.store_petty (organization_id, store_id, balance) values (v_org, p_store_id, p_delta)
    on conflict (store_id) do update set balance = store_petty.balance + p_delta, updated_at = now();
  elsif p_target = 'fuerte' then
    insert into public.store_safe (organization_id, store_id, balance) values (v_org, p_store_id, p_delta)
    on conflict (store_id) do update set balance = store_safe.balance + p_delta, updated_at = now();
  else
    raise exception 'Destino de ajuste inválido';
  end if;
  insert into public.cash_adjustments (organization_id, store_id, target, delta, reason, created_by)
  values (v_org, p_store_id, p_target, p_delta, nullif(trim(coalesce(p_reason,'')),''), auth.uid());
end; $$;

-- ── Entrega a Casa Central (desde la caja fuerte) ──
create or replace function public.deliver_to_central(p_store_id uuid, p_amount numeric, p_notes text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_bal numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_amount <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  select balance into v_bal from public.store_safe where store_id = p_store_id and organization_id = v_org;
  if coalesce(v_bal, 0) < p_amount then raise exception 'La caja fuerte no tiene ese monto (hay %)', coalesce(v_bal,0); end if;
  update public.store_safe set balance = balance - p_amount, updated_at = now() where store_id = p_store_id;
  insert into public.central_deliveries (organization_id, store_id, amount, notes, delivered_by)
  values (v_org, p_store_id, p_amount, nullif(trim(coalesce(p_notes,'')),''), auth.uid());
end; $$;
