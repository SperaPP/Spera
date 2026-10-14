-- 0117_arca_auth_tickets.sql — caché del Ticket de Acceso (TA) de ARCA/AFIP (WSAA).
--
-- WSAA emite un TA (token + sign) válido ~12h y NO permite pedir otro mientras el
-- anterior siga vigente. Guardamos el TA por organización + servicio + entorno y lo
-- reusamos hasta cerca del vencimiento. Solo lo lee/escribe el conector server-side
-- (service-role); RLS sin policies. Append-only e idempotente.

create table if not exists public.arca_auth_tickets (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service         text not null,                 -- 'wsfe'
  environment     text not null,                 -- 'homologacion' | 'produccion'
  token           text not null,
  sign            text not null,
  generation_time timestamptz not null,
  expiration_time timestamptz not null,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, service, environment)
);
alter table public.arca_auth_tickets enable row level security;
-- Sin políticas: solo el service-role (el conector corre en el servidor).

notify pgrst, 'reload schema';
