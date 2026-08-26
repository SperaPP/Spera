-- 0057_transfer_status_creada_check.sql — Permitir 'creada' en stock_transfers.status.
--
-- La 0056 hace nacer las transferencias en 'creada', pero el CHECK (de la 0026)
-- solo permitía ('enviada','recibida','cancelada') → rebotaba al crear.
-- Append-only e idempotente.

alter table public.stock_transfers drop constraint if exists stock_transfers_status_check;
alter table public.stock_transfers add constraint stock_transfers_status_check
  check (status in ('creada', 'enviada', 'recibida', 'cancelada'));
