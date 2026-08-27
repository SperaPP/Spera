-- 0072_portal_facets.sql — navegación por facetas del portal.
--
-- Devuelve, para el contexto actual (búsqueda + filtros), qué opciones de cada
-- dimensión TIENEN productos disponibles (con precio en la lista y stock > 0):
--   · main   → categorías principales disponibles (respeta temporada + búsqueda)
--   · cat    → tipos disponibles dentro de la principal elegida (+ temporada + búsqueda)
--   · season → temporadas disponibles dentro de la principal (+ búsqueda)
-- Así el sidebar no muestra categorías vacías (ej. "Acolchados" bajo "Mujer").
-- Cada faceta ignora su propia dimensión para poder cambiar de opción sin quedar sin nada.
-- Append-only e idempotente.
create or replace function public.portal_facets(
  p_org       uuid,
  p_list      uuid,
  p_warehouse uuid,
  p_main      uuid default null,
  p_season    uuid default null,
  p_search    text default null
) returns table(dim text, id uuid)
language sql stable security definer set search_path = public as $$
  with instock as (
    select distinct v.product_id
    from public.stock s
    join public.product_variants v on v.id = s.variant_id
    where s.warehouse_id = p_warehouse and (s.quantity - coalesce(s.reserved, 0)) > 0
  ),
  prod as (
    select p.id, p.main_category_id, p.category_id, p.season_id
    from public.products p
    join instock i on i.product_id = p.id
    join public.price_list_items pli on pli.product_id = p.id and pli.variant_id is null and pli.price_list_id = p_list
    where p.organization_id = p_org and p.active = true
      and (p_search is null or p_search = '' or p.name ilike '%' || p_search || '%')
  )
  select distinct 'main'::text, main_category_id from prod
    where main_category_id is not null
      and (p_season is null or season_id = p_season)
  union
  select distinct 'cat', category_id from prod
    where category_id is not null
      and (p_main is null or main_category_id = p_main)
      and (p_season is null or season_id = p_season)
  union
  select distinct 'season', season_id from prod
    where season_id is not null
      and (p_main is null or main_category_id = p_main);
$$;
