-- 0115_tn_sync_lock_owner.sql — auditoría de sistema (Tiendanube): A2.
--
-- El lease del drenador de stock se liberaba en el `finally` sin verificar propiedad:
-- si un drenado tardaba más de 90s (el lease vencía) y otro lo tomaba, el primero al
-- terminar igual lo liberaba → dos drenadores podían pisarse y empujar stock viejo.
-- Agregamos un token de dueño: cada drenado toma el lease con SU token y lo libera
-- solo si sigue siendo el dueño (ver lib/tiendanube.ts). Append-only e idempotente.

alter table public.tn_sync_lock add column if not exists owner uuid;

notify pgrst, 'reload schema';
