-- 0034_armado_reimpresion.sql — Reimpresión de la orden de armado, reservada a administración.
--  El depósito no puede reimprimir (bloqueado por 0033); un admin sí, dejando registro.
-- Append-only e idempotente.

alter table public.sales add column if not exists armado_reprint_count   int not null default 0;
alter table public.sales add column if not exists armado_last_reprint_at  timestamptz;
alter table public.sales add column if not exists armado_last_reprint_by  uuid references auth.users(id);
