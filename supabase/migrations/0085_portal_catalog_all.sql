-- 0085_portal_catalog_all.sql — catálogo COMPLETO en una sola consulta.
--
-- Devuelve todos los productos con stock en Central para la lista del cliente, con
-- todo lo necesario para filtrar/buscar/ordenar del lado del cliente: precio (y
-- promo), precio público de referencia, imagen de portada, stock, destacado,
-- categoría madre / tipo / temporada, y talles disponibles. Así el portal hace UNA
-- carga y después filtra en el navegador (instantáneo), en vez de ir al servidor
-- por cada filtro. SECURITY DEFINER (los usuarios del portal no tienen org).
-- Append-only e idempotente.

create or replace function public.portal_catalog_all(p_org uuid, p_list uuid, p_warehouse uuid)
returns table(
  id uuid, name text, price numeric, promo numeric, public_price numeric,
  image_path text, stock numeric, featured boolean,
  main_category_id uuid, category_id uuid, season_id uuid, sizes text[]
) language sql stable security definer set search_path = public as $$
  with base as (
    select p.id, p.name, pli.price, pli.promo_price as promo, p.featured,
           p.main_category_id, p.category_id, p.season_id,
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
  )
  select
    b.id, b.name, b.price, b.promo,
    (select pl2.price from public.price_list_items pl2
       join public.price_lists l2 on l2.id = pl2.price_list_id
       where pl2.product_id = b.id and pl2.variant_id is null
         and l2.organization_id = p_org and l2.name = 'Publico') as public_price,
    (select pi.path from public.product_images pi
       where pi.product_id = b.id order by pi.is_primary desc, pi.created_at limit 1) as image_path,
    b.stock, b.featured, b.main_category_id, b.category_id, b.season_id,
    (select array_agg(distinct v.size order by v.size)
       from public.product_variants v
       join public.stock s on s.variant_id = v.id
       where v.product_id = b.id and v.active = true and v.size is not null
         and s.warehouse_id = p_warehouse and (s.quantity - coalesce(s.reserved, 0)) > 0) as sizes
  from base b
  where b.stock > 0
  order by b.name;
$$;
