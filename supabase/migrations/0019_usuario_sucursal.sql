-- 0019_usuario_sucursal.sql — Sucursal fija por usuario.
--  • profiles.store_id: la sucursal asignada al usuario (vendedor).
--    El admin asigna/cambia desde Usuarios. El POS se ancla a esta sucursal.
-- Append-only e idempotente.

alter table public.profiles
  add column if not exists store_id uuid references public.stores(id) on delete set null;
