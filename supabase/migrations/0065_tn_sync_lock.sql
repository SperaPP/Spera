-- 0065_tn_sync_lock.sql — robustez del drenado de la cola de sync de stock.
--
-- Cierra dos bugs de concurrencia detectados en la auditoría:
--  · Lease de "un solo drenador por organización": el webhook (after) y el cron
--    pueden drenar a la vez → doble PUT y escrituras fuera de orden (sobreventa).
--    Con este lease, solo un drenado corre por org a la vez (se auto-libera a los 90s).
--  · fail_count: para no starvar la cola con "poison messages" (variante borrada en
--    TN que falla siempre), se cuentan los fallos y se descarta tras 10 intentos.
-- Append-only e idempotente.

create table if not exists public.tn_sync_lock (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  locked_until    timestamptz not null default now()
);
alter table public.tn_sync_lock enable row level security;
-- Sin políticas: solo service-role.

alter table public.tn_stock_sync_queue add column if not exists fail_count int not null default 0;
