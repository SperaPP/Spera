-- 0029_caja_chica_fuerte.sql — Efectivo: caja chica (por cajero) + caja fuerte (por local).
--  Apertura: el fondo = caja chica arrastrada del último cierre de ese cajero (no se
--    tipea a mano; la primera vez la setea administración con un ajuste).
--  Cierre: el cajero cuenta el efectivo y reparte: cuánto QUEDA en caja chica (para su
--    próxima apertura) y cuánto pasa a la CAJA FUERTE del local.
--  Caja fuerte: acumula lo depositado; administración entrega a Casa Central (con fecha/
--    hora) y puede ajustar (fondo inicial / correcciones). Append-only e idempotente.

-- Reparto en el cierre.
alter table public.cash_sessions add column if not exists kept_amount   numeric(14,2);  -- queda en caja chica
alter table public.cash_sessions add column if not exists to_safe_amount numeric(14,2); -- pasa a caja fuerte

-- Caja chica por (local, cajero).
create table if not exists public.petty_cash (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  cashier_id      uuid not null references auth.users(id) on delete cascade,
  balance         numeric(14,2) not null default 0,
  updated_at      timestamptz not null default now(),
  unique (store_id, cashier_id)
);

-- Caja fuerte por local.
create table if not exists public.store_safe (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  balance         numeric(14,2) not null default 0,
  updated_at      timestamptz not null default now(),
  unique (store_id)
);

-- Ajustes de caja (administración): fondo inicial y correcciones.
create table if not exists public.cash_adjustments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id),
  target          text not null check (target in ('chica', 'fuerte')),
  cashier_id      uuid references auth.users(id),   -- sólo para 'chica'
  delta           numeric(14,2) not null,
  reason          text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

-- Entregas a Casa Central (desde la caja fuerte del local).
create table if not exists public.central_deliveries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id),
  amount          numeric(14,2) not null check (amount > 0),
  notes           text,
  delivered_at    timestamptz not null default now(),
  delivered_by    uuid references auth.users(id)
);

do $$
declare t text;
begin
  foreach t in array array['petty_cash','store_safe','cash_adjustments','central_deliveries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_all on public.%I', t, t);
    execute format('create policy %I_all on public.%I for all using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())', t, t);
  end loop;
end $$;

-- Permiso de administración de caja (entregas/ajustes) para el futuro rol Administración.
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, 'caja_admin', true, true
from public.roles r where r.name = 'SuperAdministrador'
on conflict (role_id, module) do update set can_view = true, can_edit = true;

-- ── Abrir: el fondo = caja chica arrastrada (sin tipear) ─────
drop function if exists public.open_cash_session(uuid, numeric);
create or replace function public.open_cash_session(p_store_id uuid)
returns uuid language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_id uuid; v_carry numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if exists (select 1 from public.cash_sessions where organization_id = v_org and opened_by = auth.uid() and status = 'abierta') then
    raise exception 'Ya tenés una caja abierta. Cerrala antes de abrir un nuevo período.';
  end if;
  select balance into v_carry from public.petty_cash where store_id = p_store_id and cashier_id = auth.uid();
  insert into public.cash_sessions (organization_id, store_id, opening_amount, opened_by)
  values (v_org, p_store_id, coalesce(v_carry, 0), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- ── Cerrar: reparte caja chica / caja fuerte ─────────────────
drop function if exists public.close_cash_session(uuid, numeric, text);
create or replace function public.close_cash_session(p_session_id uuid, p_declared_amount numeric, p_kept_amount numeric, p_notes text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_store uuid; v_cashier uuid; v_to_safe numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_kept_amount < 0 then raise exception 'La caja chica no puede ser negativa'; end if;
  if p_kept_amount > p_declared_amount then raise exception 'La caja chica no puede superar el efectivo contado'; end if;

  select store_id, opened_by into v_store, v_cashier from public.cash_sessions
    where id = p_session_id and organization_id = v_org and status = 'abierta';
  if not found then raise exception 'Turno no encontrado o ya cerrado'; end if;

  v_to_safe := p_declared_amount - p_kept_amount;

  update public.cash_sessions
     set status = 'cerrada', declared_amount = p_declared_amount, kept_amount = p_kept_amount,
         to_safe_amount = v_to_safe, notes = p_notes, closed_by = auth.uid(), closed_at = now()
   where id = p_session_id;

  -- Caja chica del cajero = lo que queda.
  insert into public.petty_cash (organization_id, store_id, cashier_id, balance)
  values (v_org, v_store, v_cashier, p_kept_amount)
  on conflict (store_id, cashier_id) do update set balance = p_kept_amount, updated_at = now();

  -- Caja fuerte del local += lo depositado.
  if v_to_safe <> 0 then
    insert into public.store_safe (organization_id, store_id, balance)
    values (v_org, v_store, v_to_safe)
    on conflict (store_id) do update set balance = store_safe.balance + v_to_safe, updated_at = now();
  end if;
end; $$;

-- ── Ajuste de caja (administración) ──────────────────────────
create or replace function public.adjust_cash(p_store_id uuid, p_target text, p_cashier uuid, p_delta numeric, p_reason text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_target = 'chica' then
    if p_cashier is null then raise exception 'Elegí el cajero'; end if;
    insert into public.petty_cash (organization_id, store_id, cashier_id, balance)
    values (v_org, p_store_id, p_cashier, p_delta)
    on conflict (store_id, cashier_id) do update set balance = petty_cash.balance + p_delta, updated_at = now();
  elsif p_target = 'fuerte' then
    insert into public.store_safe (organization_id, store_id, balance)
    values (v_org, p_store_id, p_delta)
    on conflict (store_id) do update set balance = store_safe.balance + p_delta, updated_at = now();
  else
    raise exception 'Destino de ajuste inválido';
  end if;
  insert into public.cash_adjustments (organization_id, store_id, target, cashier_id, delta, reason, created_by)
  values (v_org, p_store_id, p_target, case when p_target = 'chica' then p_cashier else null end, p_delta, nullif(trim(coalesce(p_reason,'')),''), auth.uid());
end; $$;

-- ── Entrega a Casa Central (desde la caja fuerte) ───────────
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
