-- 0025_logistica.sql — Logística: control de picking + despacho.
--  Estados de fulfillment por venta:
--    entregado  → mostrador y cambios (en persona, instantáneo)
--    pendiente  → mayorista/online: falta controlar
--    controlado → control OK, esperando despacho (puede no ser inmediato)
--    despachado → despachado con método + tracking
--  En Ventas "Completado" = entregado o despachado.
--  Métodos de despacho: catálogo configurable (Entrega en punto físico / Correo
--  Argentino / Teamwork, y los que se agreguen). Append-only e idempotente.

-- ── Catálogo de métodos de despacho ─────────────────────────
create table if not exists public.shipping_methods (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  active           boolean not null default true,
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  unique (organization_id, name)
);
alter table public.shipping_methods enable row level security;
drop policy if exists shipping_methods_all on public.shipping_methods;
create policy shipping_methods_all on public.shipping_methods for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

insert into public.shipping_methods (organization_id, name, position)
select o.id, m.name, m.pos
from public.organizations o
join (values ('Entrega en punto físico', 1), ('Correo Argentino', 2), ('Teamwork', 3)) as m(name, pos) on true
where o.name = 'Bodysculpt'
on conflict (organization_id, name) do nothing;

-- ── Campos de fulfillment en la venta ───────────────────────
alter table public.sales add column if not exists fulfillment_status text not null default 'entregado'
  check (fulfillment_status in ('entregado', 'pendiente', 'controlado', 'despachado'));
alter table public.sales add column if not exists shipping_method_id uuid references public.shipping_methods(id);
alter table public.sales add column if not exists tracking       text;
alter table public.sales add column if not exists dispatch_notes text;
alter table public.sales add column if not exists controlled_at  timestamptz;
alter table public.sales add column if not exists controlled_by  uuid references auth.users(id);
alter table public.sales add column if not exists dispatched_at  timestamptz;
alter table public.sales add column if not exists dispatched_by  uuid references auth.users(id);

create index if not exists sales_fulfillment_idx on public.sales (organization_id, fulfillment_status, created_at desc);

-- ── Trigger: define el estado al crear la venta ─────────────
create or replace function public.set_fulfillment_status() returns trigger language plpgsql as $$
begin
  if new.channel = 'cambio' then
    new.fulfillment_status := 'entregado';
  elsif exists (select 1 from public.stores st where st.id = new.store_id and st.is_wholesale) then
    new.fulfillment_status := 'pendiente';
  else
    new.fulfillment_status := 'entregado';
  end if;
  return new;
end; $$;

drop trigger if exists sales_set_fulfillment on public.sales;
create trigger sales_set_fulfillment before insert on public.sales
  for each row execute function public.set_fulfillment_status();

-- Backfill de las ventas existentes.
update public.sales s set fulfillment_status = case
  when s.channel = 'cambio' then 'entregado'
  when exists (select 1 from public.stores st where st.id = s.store_id and st.is_wholesale) then 'pendiente'
  else 'entregado' end
where true;
