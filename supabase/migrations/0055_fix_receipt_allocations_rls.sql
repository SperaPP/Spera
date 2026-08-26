-- 0055_fix_receipt_allocations_rls.sql — Fix RLS de receipt_allocations.
--
-- receipt_allocations (mig 0046) quedó con RLS activo pero SIN política → cobrar
-- imputando a un pedido fallaba ("new row violates row-level security policy").
-- No tiene organization_id propio, así que se scopea por el recibo padre.
-- Append-only e idempotente.

alter table public.receipt_allocations enable row level security;

drop policy if exists receipt_allocations_all on public.receipt_allocations;
create policy receipt_allocations_all on public.receipt_allocations for all
  using (exists (select 1 from public.receipts r where r.id = receipt_id and r.organization_id = public.current_org_id()))
  with check (exists (select 1 from public.receipts r where r.id = receipt_id and r.organization_id = public.current_org_id()));
