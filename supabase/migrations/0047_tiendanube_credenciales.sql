-- 0047_tiendanube_credenciales.sql — Tanda 3a: guardado del token de Tiendanube.
--
-- El OAuth de TN devuelve un access_token de larga duración (no vence) + el store_id
-- (user_id). Se guarda una fila por organización. Acceso solo vía service-role
-- (server-side); RLS activo sin políticas para bloquear el resto.
-- También un product_channels.external_id ya existía en diseño; acá aseguramos la
-- tabla de links producto↔canal por si no está.
-- Append-only e idempotente.

create table if not exists public.tiendanube_credentials (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  store_id        text not null,          -- user_id de TN
  access_token    text not null,
  scope           text,
  connected_at    timestamptz not null default now(),
  connected_by    uuid references auth.users(id)
);

alter table public.tiendanube_credentials enable row level security;
-- Sin políticas: solo el service-role (server) lee/escribe. El resto queda bloqueado.

-- Links producto ↔ canal Tiendanube (para adoptar, no duplicar). Match por SKU en 3b.
create table if not exists public.tiendanube_links (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  variant_id         uuid not null references public.product_variants(id) on delete cascade,
  tn_product_id      text not null,
  tn_variant_id      text not null,
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  unique (organization_id, variant_id)
);
alter table public.tiendanube_links enable row level security;
