-- 0032_ubicacion_por_variante.sql — La ubicación en depósito es por VARIANTE, no por producto.
--  Distintos talles/colores de un mismo producto pueden estar en estantes distintos.
--  Reemplaza a 0031 (que la puso a nivel producto).
-- Append-only e idempotente.

alter table public.product_variants add column if not exists loc_fila     smallint;
alter table public.product_variants add column if not exists loc_estante  smallint;
alter table public.product_variants add column if not exists loc_cubiculo smallint;

-- La ubicación a nivel producto quedó obsoleta.
alter table public.products drop column if exists loc_fila;
alter table public.products drop column if exists loc_estante;
alter table public.products drop column if exists loc_cubiculo;
