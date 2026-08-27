-- 0070_portal_catalog_filtros.sql — el catálogo del portal filtra también por
-- categoría PRINCIPAL y TEMPORADA (para el sidebar de navegación).
-- Los params nuevos van al final con default null → una sola llamada (8 u 10 args)
-- resuelve al mismo function. Se dropea la firma vieja de 8 args para que no queden
-- dos overloads (evita ambigüedad en PostgREST).
-- Append-only e idempotente.
drop function if exists public.portal_catalog(uuid, uuid, uuid, uuid, text, boolean, integer, integer);
create or replace function public.portal_catalog(
  p_org           uuid,
  p_list          uuid,
  p_warehouse     uuid,
  p_category      uuid    default null,
  p_search        text    default null,
  p_featured      boolean default false,
  p_limit         integer default 24,
  p_offset        integer default 0,
  p_main_category uuid    default null,
  p_season        uuid    default null
) returns table(id uuid, name text, has_image boolean, price numeric, stock numeric, featured boolean, total bigint)
language sql stable security definer set search_path = public as $$
  with base as (
    select p.id, p.name, p.has_image, pli.price, p.featured,
      coalesce((
        select sum(s.quantity - s.reserved) from public.stock s
        join public.product_variants v on v.id = s.variant_id
        where v.product_id = p.id and s.warehouse_id = p_warehouse
      ), 0) as stock
    from public.products p
    join public.price_list_items pli
      on pli.product_id = p.id and pli.variant_id is null and pli.price_list_id = p_list
    where p.organization_id = p_org and p.active = true
      and (p_category is null or p.category_id = p_category)
      and (p_main_category is null or p.main_category_id = p_main_category)
      and (p_season is null or p.season_id = p_season)
      and (p_search is null or p_search = '' or p.name ilike '%' || p_search || '%')
      and (p_featured = false or p.featured = true)
  )
  select id, name, has_image, price, stock, featured, count(*) over() as total
  from base
  where stock > 0
  order by name
  limit greatest(1, p_limit) offset greatest(0, p_offset);
$$;
