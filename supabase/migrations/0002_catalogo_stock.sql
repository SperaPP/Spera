-- 0002_catalogo_stock.sql — Depósitos, puntos de venta, catálogo con variantes,
-- stock por depósito, movimientos y transferencias. Append-only e idempotente.

-- ─────────────────────────────────────────────────────────────
-- Depósitos (stock físico) y Puntos de venta (con caja)
-- Regla clave: DEPÓSITO ≠ PUNTO DE VENTA. Tiendanube vende del depósito
-- Mayorista - Central → un store puede apuntar a un warehouse que no es "suyo".
-- ─────────────────────────────────────────────────────────────
create table if not exists public.warehouses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.stores (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  name               text not null,
  warehouse_id       uuid not null references public.warehouses(id),
  type               text not null default 'fisico' check (type in ('fisico', 'online')),
  has_cash_register  boolean not null default true,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (organization_id, name)
);

-- ─────────────────────────────────────────────────────────────
-- Catálogo: producto (modelo) + variantes (unidad vendible)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  category        text,
  brand           text,
  -- Define qué ejes de variación tiene el producto:
  variation_type  text not null default 'none' check (variation_type in ('none','size','size_color')),
  tax_rate        numeric(5,2) not null default 21,  -- % IVA (para cuando entre facturación)
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists public.product_variants (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  size            text,   -- null si el producto no varía por talle
  color           text,   -- null si no varía por color
  sku             text,
  barcode         text,   -- Code128 interno, escaneable e imprimible en etiqueta
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Una sola combinación talle/color por producto.
create unique index if not exists product_variants_combo_uq
  on public.product_variants (product_id, coalesce(size,''), coalesce(color,''));
-- Código de barras único por organización (para escanear sin ambigüedad).
create unique index if not exists product_variants_barcode_uq
  on public.product_variants (organization_id, barcode) where barcode is not null;
create index if not exists product_variants_product_idx
  on public.product_variants (product_id);

-- ─────────────────────────────────────────────────────────────
-- Stock por (depósito, variante)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.stock (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  quantity        integer not null default 0,
  updated_at      timestamptz not null default now(),
  unique (warehouse_id, variant_id)
);

-- Auditoría de todo movimiento de stock (ingreso, venta, devolución, transfer, ajuste).
create table if not exists public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id),
  variant_id      uuid not null references public.product_variants(id),
  delta           integer not null,          -- + ingreso / − egreso
  reason          text not null,             -- 'ingreso' | 'venta' | 'devolucion' | 'transferencia' | 'ajuste'
  reference_type  text,
  reference_id    uuid,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);
create index if not exists stock_movements_variant_idx
  on public.stock_movements (variant_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- Transferencias entre depósitos
-- ─────────────────────────────────────────────────────────────
create table if not exists public.stock_transfers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  from_warehouse_id uuid not null references public.warehouses(id),
  to_warehouse_id   uuid not null references public.warehouses(id),
  status            text not null default 'pendiente' check (status in ('pendiente','completada','cancelada')),
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create table if not exists public.stock_transfer_items (
  id          uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  variant_id  uuid not null references public.product_variants(id),
  quantity    integer not null check (quantity > 0)
);

-- ─────────────────────────────────────────────────────────────
-- RLS (patrón estándar: acceso acotado a la org)
-- ─────────────────────────────────────────────────────────────
alter table public.warehouses           enable row level security;
alter table public.stores               enable row level security;
alter table public.products             enable row level security;
alter table public.product_variants     enable row level security;
alter table public.stock                enable row level security;
alter table public.stock_movements      enable row level security;
alter table public.stock_transfers      enable row level security;
alter table public.stock_transfer_items enable row level security;

drop policy if exists warehouses_all on public.warehouses;
create policy warehouses_all on public.warehouses for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists stores_all on public.stores;
create policy stores_all on public.stores for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists products_all on public.products;
create policy products_all on public.products for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists product_variants_all on public.product_variants;
create policy product_variants_all on public.product_variants for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists stock_all on public.stock;
create policy stock_all on public.stock for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists stock_movements_all on public.stock_movements;
create policy stock_movements_all on public.stock_movements for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

drop policy if exists stock_transfers_all on public.stock_transfers;
create policy stock_transfers_all on public.stock_transfers for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

-- transfer_items no tiene organization_id: se acota vía la transferencia padre.
drop policy if exists stock_transfer_items_all on public.stock_transfer_items;
create policy stock_transfer_items_all on public.stock_transfer_items for all
  using (exists (
    select 1 from public.stock_transfers t
    where t.id = transfer_id and t.organization_id = public.current_org_id()
  ))
  with check (exists (
    select 1 from public.stock_transfers t
    where t.id = transfer_id and t.organization_id = public.current_org_id()
  ));

-- ─────────────────────────────────────────────────────────────
-- Semilla: 5 depósitos + 6 puntos de venta
-- ─────────────────────────────────────────────────────────────
insert into public.warehouses (organization_id, name)
select o.id, w.name
from public.organizations o
cross join (values ('Palermo'), ('Devoto'), ('Villa Luro'),
                   ('Mayorista - Local'), ('Mayorista - Central')) as w(name)
where o.name = 'Bodysculpt'
  on conflict (organization_id, name) do nothing;

-- Cada store apunta a su depósito; Tiendanube (online, sin caja) usa Mayorista - Central.
insert into public.stores (organization_id, name, warehouse_id, type, has_cash_register)
select o.id, s.store_name, w.id, s.store_type, s.caja
from public.organizations o
join (values
  ('Palermo',             'Palermo',             'fisico', true),
  ('Devoto',              'Devoto',              'fisico', true),
  ('Villa Luro',          'Villa Luro',          'fisico', true),
  ('Mayorista - Local',   'Mayorista - Local',   'fisico', true),
  ('Mayorista - Central', 'Mayorista - Central', 'fisico', true),
  ('Tiendanube',          'Mayorista - Central', 'online', false)
) as s(store_name, wh_name, store_type, caja) on true
join public.warehouses w on w.organization_id = o.id and w.name = s.wh_name
where o.name = 'Bodysculpt'
  on conflict (organization_id, name) do nothing;
