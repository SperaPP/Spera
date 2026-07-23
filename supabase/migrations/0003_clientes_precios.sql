-- 0003_clientes_precios.sql — Listas de precios, tipos de cliente, clientes con
-- cuenta corriente y precios por producto. Append-only e idempotente.

-- ─────────────────────────────────────────────────────────────
-- Listas de precios y tipos de cliente
-- (el tipo de cliente define la lista; el precio es por PRODUCTO, IVA incluido)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.price_lists (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.customer_types (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.organizations(id) on delete cascade,
  name                      text not null,
  price_list_id             uuid references public.price_lists(id),
  default_fiscal_condition  text not null default 'consumidor_final'
    check (default_fiscal_condition in ('consumidor_final','responsable_inscripto','monotributo','exento')),
  active                    boolean not null default true,
  created_at                timestamptz not null default now(),
  unique (organization_id, name)
);

-- ─────────────────────────────────────────────────────────────
-- Clientes + cuenta corriente
-- balance: saldo de cuenta corriente. Positivo = el cliente DEBE.
--          Negativo = tiene saldo A FAVOR (p. ej. una devolución aprobada).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.customers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  name              text not null,
  customer_type_id  uuid references public.customer_types(id),
  fiscal_condition  text not null default 'consumidor_final'
    check (fiscal_condition in ('consumidor_final','responsable_inscripto','monotributo','exento')),
  doc_type          text,   -- 'DNI' | 'CUIT' | 'CUIL' | ...
  doc_number        text,
  email             text,
  phone             text,
  balance           numeric(14,2) not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists customers_name_idx on public.customers (organization_id, name);

-- Movimientos de cuenta corriente (auditoría del balance).
create table if not exists public.customer_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  delta           numeric(14,2) not null,   -- + deuda / − pago o saldo a favor
  reason          text not null,            -- 'venta' | 'cobranza' | 'devolucion' | 'ajuste'
  reference_type  text,
  reference_id    uuid,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);
create index if not exists customer_movements_customer_idx
  on public.customer_movements (customer_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- Precios: por producto y lista, con override por variante opcional.
-- Resolución: si existe fila con variant_id la gana; si no, la de producto.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.price_list_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  price_list_id   uuid not null references public.price_lists(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  variant_id      uuid references public.product_variants(id) on delete cascade,  -- null = precio de producto
  price           numeric(14,2) not null,   -- IVA incluido (precio final)
  updated_at      timestamptz not null default now()
);
create unique index if not exists price_list_items_uq
  on public.price_list_items (price_list_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
alter table public.price_lists       enable row level security;
alter table public.customer_types    enable row level security;
alter table public.customers         enable row level security;
alter table public.customer_movements enable row level security;
alter table public.price_list_items  enable row level security;

drop policy if exists price_lists_all on public.price_lists;
create policy price_lists_all on public.price_lists for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists customer_types_all on public.customer_types;
create policy customer_types_all on public.customer_types for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists customers_all on public.customers;
create policy customers_all on public.customers for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists customer_movements_all on public.customer_movements;
create policy customer_movements_all on public.customer_movements for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists price_list_items_all on public.price_list_items;
create policy price_list_items_all on public.price_list_items for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

-- ─────────────────────────────────────────────────────────────
-- Semilla: listas + tipos de cliente + cliente Consumidor Final
-- ─────────────────────────────────────────────────────────────
insert into public.price_lists (organization_id, name)
select o.id, l.name
from public.organizations o
cross join (values ('Minorista'), ('Mayorista')) as l(name)
where o.name = 'Bodysculpt'
  on conflict (organization_id, name) do nothing;

insert into public.customer_types (organization_id, name, price_list_id, default_fiscal_condition)
select o.id, t.type_name, pl.id, t.fiscal
from public.organizations o
join (values
  ('Minorista', 'Minorista', 'consumidor_final'),
  ('Mayorista', 'Mayorista', 'responsable_inscripto')
) as t(type_name, list_name, fiscal) on true
join public.price_lists pl on pl.organization_id = o.id and pl.name = t.list_name
where o.name = 'Bodysculpt'
  on conflict (organization_id, name) do nothing;

-- Cliente por defecto para venta minorista de mostrador.
insert into public.customers (organization_id, name, customer_type_id, fiscal_condition)
select o.id, 'Consumidor Final', ct.id, 'consumidor_final'
from public.organizations o
join public.customer_types ct on ct.organization_id = o.id and ct.name = 'Minorista'
where o.name = 'Bodysculpt'
  and not exists (
    select 1 from public.customers c
    where c.organization_id = o.id and c.name = 'Consumidor Final'
  );
