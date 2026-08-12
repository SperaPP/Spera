-- 0016_producto_ciclo_vida.sql — Clasificación de ciclo de vida del producto.
--  • products.lifecycle: 'actual' (default) | 'discontinuo'.
--  • Independiente de active: un producto puede ser 'discontinuo' pero seguir
--    'active' para liquidar el stock remanente. No afecta la venta por sí solo.
-- Append-only e idempotente.

alter table public.products
  add column if not exists lifecycle text not null default 'actual';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_lifecycle_chk'
  ) then
    alter table public.products
      add constraint products_lifecycle_chk check (lifecycle in ('actual', 'discontinuo'));
  end if;
end $$;
