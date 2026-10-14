-- 0118_arca_invoices.sql — comprobantes electrónicos emitidos (CAE) por venta.
--
-- Guarda el resultado de facturar una venta en ARCA: tipo/número de comprobante,
-- CAE y su vencimiento, documento del receptor e importes. Único por venta + entorno
-- (una venta se factura una sola vez en homologación y una sola vez en producción).
-- Lectura acotada a la organización; la escritura la hace el conector (service-role)
-- después del guard de admin. Append-only e idempotente.

create table if not exists public.arca_invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id         uuid not null references public.sales(id) on delete cascade,
  environment     text not null,            -- 'homologacion' | 'produccion'
  cbte_tipo       int  not null,            -- 1=Factura A, 6=Factura B, ...
  pto_vta         int  not null,
  cbte_nro        bigint not null,
  doc_tipo        int  not null,            -- 80=CUIT, 96=DNI, 99=consumidor final
  doc_nro         text not null,
  imp_neto        numeric(14,2) not null,
  imp_iva         numeric(14,2) not null,
  imp_total       numeric(14,2) not null,
  cae             text not null,
  cae_vto         date not null,
  cbte_fch        date not null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (organization_id, sale_id, environment)
);
alter table public.arca_invoices enable row level security;

drop policy if exists arca_invoices_read on public.arca_invoices;
create policy arca_invoices_read on public.arca_invoices for select
  using (organization_id = public.current_org_id());
-- Sin policy de escritura: la inserta el conector con service-role (tras requireAdmin).

notify pgrst, 'reload schema';
