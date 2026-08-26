-- 0049_categoria_principal_temporada.sql — Categoría principal + Temporada en productos.
--
-- El producto pasa a tener TRES dimensiones de clasificación:
--   · Categoría PRINCIPAL (madre): Mujer / Hombre / Home / Outlet  → main_categories
--   · Categoría SECUNDARIA (hija/tipo): Pantalón, Remera…          → categories (ya existía, category_id)
--   · Temporada: Primavera-Verano / Otoño-Invierno / Atemporal…   → seasons
-- main_categories y seasons son catálogos editables (como categories/colors/etc.).
-- Append-only e idempotente.

create table if not exists public.main_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  active          boolean not null default true,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.seasons (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  active          boolean not null default true,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

alter table public.main_categories enable row level security;
alter table public.seasons enable row level security;

drop policy if exists main_categories_all on public.main_categories;
create policy main_categories_all on public.main_categories for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());
drop policy if exists seasons_all on public.seasons;
create policy seasons_all on public.seasons for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());

alter table public.products add column if not exists main_category_id uuid references public.main_categories(id);
alter table public.products add column if not exists season_id        uuid references public.seasons(id);

-- Seed de las 4 madres para cada organización.
insert into public.main_categories (organization_id, name, position)
select o.id, x.name, x.pos
from public.organizations o
cross join (values ('Mujer',1),('Hombre',2),('Home',3),('Outlet',4)) as x(name, pos)
on conflict (organization_id, name) do nothing;

-- Seed inicial de temporadas (editables en Configuración).
insert into public.seasons (organization_id, name, position)
select o.id, x.name, x.pos
from public.organizations o
cross join (values ('Primavera-Verano',1),('Otoño-Invierno',2),('Atemporal',3)) as x(name, pos)
on conflict (organization_id, name) do nothing;
