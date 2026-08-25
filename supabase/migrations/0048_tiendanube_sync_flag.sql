-- 0048_tiendanube_sync_flag.sql — Tanda 3b: flag "Sincronizar con Tiendanube".
--
-- Por producto: si está en true, ese producto se maneja/sincroniza con TN.
-- Arranca en FALSE para TODOS (nada se sincroniza). El dueño los activa por ficha
-- o en masa (por lista/Excel) cuando empiece a usar el sistema.
-- El push real de stock/precio a TN NO se hace todavía (Mayorista-Central sin cargar).
-- Append-only e idempotente.

alter table public.products add column if not exists tn_sync boolean not null default false;
