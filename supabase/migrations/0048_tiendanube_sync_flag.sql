-- 0048_tiendanube_sync_flag.sql — Tanda 3b: flag "Sincronizar con Tiendanube".
--
-- Por producto: si está en true, ese producto se maneja/sincroniza con TN.
-- Arranca en FALSE para TODOS (nada se sincroniza). El dueño los activa por ficha
-- o en masa (por lista/Excel) cuando empiece a usar el sistema.
-- El push real de stock/precio a TN NO se hace todavía (Mayorista-Central sin cargar).
-- Append-only e idempotente.

alter table public.products add column if not exists tn_sync boolean not null default false;

-- Garantía dura: un producto discontinuo nunca puede quedar sincronizado con TN
-- (aplica a cualquier vía: botón, edición o carga masiva).
do $$ begin
  alter table public.products add constraint products_tn_sync_no_discontinuo
    check (not (tn_sync and lifecycle = 'discontinuo'));
exception when duplicate_object then null; end $$;
