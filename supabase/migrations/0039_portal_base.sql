-- 0039_portal_base.sql — Base del portal mayorista.
--  • customers.auth_user_id: liga un cliente a su login del portal.
--  • customers.portal_status: pendiente / aprobado / rechazado (null = cliente
--    interno, no usa el portal).
--  • products.featured: destacados del portal.
--  • handle_new_user: los registros del portal NO crean perfil de empleado.
-- Append-only e idempotente.

alter table public.customers add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.customers add column if not exists portal_status text
  check (portal_status in ('pendiente', 'aprobado', 'rechazado'));
create unique index if not exists customers_auth_user_uq on public.customers (auth_user_id) where auth_user_id is not null;

alter table public.products add column if not exists featured boolean not null default false;

-- El registro del portal marca user_metadata.portal = 'true' → no crear profile
-- de empleado (el cliente se crea aparte, ligado por auth_user_id).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_org  uuid;
  v_role uuid;
  v_first boolean;
begin
  if coalesce(new.raw_user_meta_data->>'portal', '') = 'true' then
    return new;  -- usuario del portal mayorista: sin perfil de empleado
  end if;

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
