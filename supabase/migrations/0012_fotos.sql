-- 0012_fotos.sql — Galería de imágenes por producto, asignables por color.
-- Los archivos viven en Supabase Storage (bucket 'product-images'); acá guardamos
-- la referencia (path) de forma agnóstica. Append-only e idempotente.

create table if not exists public.product_images (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  path            text not null,          -- key dentro del bucket
  color           text,                   -- null = general (aplica a todas las variantes)
  position        integer not null default 0,
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists product_images_product_idx on public.product_images (product_id);

alter table public.product_images enable row level security;

drop policy if exists product_images_all on public.product_images;
create policy product_images_all on public.product_images for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
