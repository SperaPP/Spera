-- 0119_arca_notas_credito.sql — soporte de notas de crédito en arca_invoices.
--
-- Una venta puede tener su FACTURA y, además, una NOTA DE CRÉDITO que la anula/corrige.
-- El unique viejo (organization_id, sale_id, environment) impedía guardar dos
-- comprobantes para la misma venta. Se reemplaza por la identidad real del comprobante
-- (org + entorno + tipo + PV + número, que es única en ARCA). Se agrega:
--   · asociado_a   → la NC apunta a la factura que corrige.
--   · iva_receptor_id → condición IVA del receptor usada (para reusarla en la NC).
-- Append-only e idempotente.

alter table public.arca_invoices add column if not exists asociado_a uuid references public.arca_invoices(id) on delete set null;
alter table public.arca_invoices add column if not exists iva_receptor_id int;

-- Quitar cualquier unique viejo de la tabla (el de sale_id) sin depender del nombre.
do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'public.arca_invoices'::regclass and contype = 'u'
  loop
    execute format('alter table public.arca_invoices drop constraint %I', r.conname);
  end loop;
end $$;

-- Identidad del comprobante: única por organización + entorno + tipo + PV + número.
do $$ begin
  alter table public.arca_invoices
    add constraint arca_invoices_cbte_uq unique (organization_id, environment, cbte_tipo, pto_vta, cbte_nro);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
