-- 0037_roles.sql — Roles del negocio + permisos, y ampliación de is_admin().
--   SuperAdministrador: acceso total (solo los dueños). is_admin = true.
--   Administrador: puede todo lo operativo + acciones admin (anular venta,
--     reimprimir armado, ajustar saldo, gestionar usuarios/roles) → is_admin = true.
--   Vendedor-Mostrador / Vendedor-Mayorista / Depósito y Logística / Supervisor:
--     por permisos de módulo (matriz), sin acciones admin.
-- Append-only e idempotente. (V = ver; E = ver+editar.)

-- ── is_admin(): ahora también el rol Administrador ───────────
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid() and r.name in ('SuperAdministrador', 'Administrador')
  );
$$;

-- ── Crear los roles (idempotente) ────────────────────────────
insert into public.roles (organization_id, name)
select o.id, r.name
from public.organizations o
cross join (values
  ('Vendedor-Mostrador'), ('Vendedor-Mayorista'), ('Depósito y Logística'),
  ('Administrador'), ('Supervisor')
) as r(name)
where o.name = 'Bodysculpt'
on conflict (organization_id, name) do nothing;

-- ── Permisos por rol ─────────────────────────────────────────
-- Vendedor-Mostrador
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, m.module, m.v, m.e
from public.roles r cross join (values
  ('pos', true, true), ('caja', true, true), ('ventas', true, false), ('stock', true, false)
) as m(module, v, e)
where r.name = 'Vendedor-Mostrador'
on conflict (role_id, module) do update set can_view = excluded.can_view, can_edit = excluded.can_edit;

-- Vendedor-Mayorista
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, m.module, m.v, m.e
from public.roles r cross join (values
  ('pos', true, true), ('caja', true, true), ('ventas', true, false),
  ('clientes', true, true), ('cobranzas', true, true), ('stock', true, false)
) as m(module, v, e)
where r.name = 'Vendedor-Mayorista'
on conflict (role_id, module) do update set can_view = excluded.can_view, can_edit = excluded.can_edit;

-- Depósito y Logística
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, m.module, m.v, m.e
from public.roles r cross join (values
  ('logistica', true, true), ('control_stock', true, true), ('stock', true, true),
  ('transferencias', true, true), ('productos', true, true), ('ventas', true, false)
) as m(module, v, e)
where r.name = 'Depósito y Logística'
on conflict (role_id, module) do update set can_view = excluded.can_view, can_edit = excluded.can_edit;

-- Administrador (todos los módulos en E)
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, m.module, true, true
from public.roles r cross join (values
  ('pos'), ('ventas'), ('logistica'), ('productos'), ('stock'), ('control_stock'),
  ('transferencias'), ('clientes'), ('precios'), ('caja'), ('caja_admin'),
  ('cobranzas'), ('reportes'), ('configuracion'), ('tiendanube')
) as m(module)
where r.name = 'Administrador'
on conflict (role_id, module) do update set can_view = excluded.can_view, can_edit = excluded.can_edit;

-- Supervisor (control/supervisión: ve todo, edita control_stock/caja_admin/reportes)
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, m.module, m.v, m.e
from public.roles r cross join (values
  ('reportes', true, true), ('control_stock', true, true), ('caja_admin', true, true),
  ('ventas', true, false), ('logistica', true, false), ('stock', true, false),
  ('caja', true, false), ('clientes', true, false), ('cobranzas', true, false),
  ('productos', true, false), ('precios', true, false)
) as m(module, v, e)
where r.name = 'Supervisor'
on conflict (role_id, module) do update set can_view = excluded.can_view, can_edit = excluded.can_edit;
