-- 0075_portal_orden_conteo.sql — el catálogo del portal se puede ORDENAR (nombre /
-- precio) y las facetas devuelven el CONTEO de productos por opción (para el sidebar).
-- Se dropean las firmas previas para no dejar overloads ambiguos.
-- Append-only e idempotente.

-- ── portal_catalog con p_sort ────────────────────────────────────────────────
drop function if exists public.portal_catalog(uuid, uuid, uuid, uuid, text, boolean, integer, integer, uuid, uuid);
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
  p_season        uuid    default null,
  p_sort          text    default 'name'
) returns table(id uuid, name text, has_image boolean, price numeric, stock numeric, featured boolean, total bigint)
language sql stable security definer set search_path = public as $$
  with base as (
    select p.id, p.name, p.has_image, pli.price, p.featured,
      coalesce((
        select sum(greatest(s.quantity - coalesce(s.reserved, 0), 0))
        from public.stock s
        join public.product_variants v on v.id = s.variant_id
        where v.product_id = p.id and v.active = true and s.warehouse_id = p_warehouse
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
  order by
    (case when p_sort = 'price_asc'  then price end) asc  nulls last,
    (case when p_sort = 'price_desc' then price end) desc nulls last,
    name
  limit greatest(1, p_limit) offset greatest(0, p_offset);
$$;

-- ── portal_facets con conteo por opción ──────────────────────────────────────
drop function if exists public.portal_facets(uuid, uuid, uuid, uuid, uuid, text);
create or replace function public.portal_facets(
  p_org       uuid,
  p_list      uuid,
  p_warehouse uuid,
  p_main      uuid default null,
  p_season    uuid default null,
  p_search    text default null
) returns table(dim text, id uuid, cnt bigint)
language sql stable security definer set search_path = public as $$
  with instock as (
    select distinct v.product_id
    from public.stock s
    join public.product_variants v on v.id = s.variant_id
    where v.active = true and s.warehouse_id = p_warehouse
      and (s.quantity - coalesce(s.reserved, 0)) > 0
  ),
  prod as (
    select p.id, p.main_category_id, p.category_id, p.season_id
    from public.products p
    join instock i on i.product_id = p.id
    join public.price_list_items pli on pli.product_id = p.id and pli.variant_id is null and pli.price_list_id = p_list
    where p.organization_id = p_org and p.active = true
      and (p_search is null or p_search = '' or p.name ilike '%' || p_search || '%')
  )
  select 'main'::text, main_category_id, count(distinct id) from prod
    where main_category_id is not null and (p_season is null or season_id = p_season)
    group by main_category_id
  union all
  select 'cat', category_id, count(distinct id) from prod
    where category_id is not null and (p_main is null or main_category_id = p_main) and (p_season is null or season_id = p_season)
    group by category_id
  union all
  select 'season', season_id, count(distinct id) from prod
    where season_id is not null and (p_main is null or main_category_id = p_main)
    group by season_id;
$$;
