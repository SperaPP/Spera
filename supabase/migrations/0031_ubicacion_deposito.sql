-- 0031_ubicacion_deposito.sql — Ubicación de la prenda en el depósito (Fila - Estante - Cubículo).
--  Las estanterías están numeradas; la fila ordena el recorrido de armado del pedido.
-- Append-only e idempotente.

alter table public.products add column if not exists loc_fila     smallint;
alter table public.products add column if not exists loc_estante  smallint;
alter table public.products add column if not exists loc_cubiculo smallint;
