-- 0001_base.sql — Organización, perfiles, roles, permisos, RLS y bootstrap.
-- Append-only e idempotente. Correr en el SQL Editor de Supabase, en orden.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Tablas núcleo
-- ─────────────────────────────────────────────────────────────
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.role_permissions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id         uuid not null references public.roles(id) on delete cascade,
  module          text not null,
  can_view        boolean not null default false,
  can_edit        boolean not null default false,
  unique (role_id, module)
);

create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  role_id         uuid references public.roles(id) on delete set null,
  full_name       text,
  email           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Funciones de contexto (SECURITY DEFINER → no recursan contra profiles por RLS)
-- ─────────────────────────────────────────────────────────────
create or replace function public.current_org_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid() and r.name = 'SuperAdministrador'
  );
$$;

-- Devuelve { modulo: { view, edit } } para el usuario actual.
create or replace function public.get_my_permissions()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(rp.module, jsonb_build_object('view', rp.can_view, 'edit', rp.can_edit)),
    '{}'::jsonb
  )
  from public.profiles p
  join public.role_permissions rp on rp.role_id = p.role_id
  where p.id = auth.uid();
$$;

-- Bootstrap: cada usuario nuevo de Auth crea su profile en la (única) org.
-- El PRIMER usuario queda como SuperAdministrador; el resto sin rol (a asignar).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_org  uuid;
  v_role uuid;
  v_first boolean;
begin
  select id into v_org from public.organizations order by created_at limit 1;
  select count(*) = 0 into v_first from public.profiles;
  if v_first then
    select id into v_role from public.roles
      where organization_id = v_org and name = 'SuperAdministrador' limit 1;
  end if;
  insert into public.profiles (id, organization_id, role_id, email, full_name)
  values (new.id, v_org, v_role, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
alter table public.organizations   enable row level security;
alter table public.roles           enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles        enable row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select
  using (id = public.current_org_id());

drop policy if exists roles_all on public.roles;
create policy roles_all on public.roles for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists role_permissions_all on public.role_permissions;
create policy role_permissions_all on public.role_permissions for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

-- profiles: ver los de mi org; editar solo el propio.
-- (Cambiar el rol de OTRO se hace con service-role tras el guard de permisos.)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (organization_id = public.current_org_id());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Semilla: organización + rol SuperAdministrador con todos los permisos
-- ─────────────────────────────────────────────────────────────
insert into public.organizations (name) values ('Bodysculpt')
  on conflict (name) do nothing;

insert into public.roles (organization_id, name)
select o.id, 'SuperAdministrador' from public.organizations o where o.name = 'Bodysculpt'
  on conflict (organization_id, name) do nothing;

insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, m.module, true, true
from public.roles r
cross join (values
  ('productos'), ('stock'), ('transferencias'), ('ventas'), ('pos'),
  ('devoluciones'), ('logistica'), ('clientes'), ('precios'),
  ('caja'), ('cobranzas'), ('tiendanube'), ('reportes'), ('configuracion')
) as m(module)
where r.name = 'SuperAdministrador'
  on conflict (role_id, module)
  do update set can_view = excluded.can_view, can_edit = excluded.can_edit;
