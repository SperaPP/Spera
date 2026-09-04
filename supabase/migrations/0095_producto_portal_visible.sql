-- 0095_producto_portal_visible.sql — "Publicar en portal" por producto.
--
-- Nueva columna products.portal_visible (default true = todo lo que hoy se ve
-- sigue viéndose). Si un producto la tiene en false, NO aparece en el portal
-- mayorista (ni en el catálogo, ni en las facetas, ni por link directo).
-- El detalle por link directo se corta en el código (lib/portal-catalog.ts).
--
-- Además: la actualización masiva (update_products) entiende la columna `portal`
-- (Sí/No) y el export la incluye. Se recrea update_products como superset de 0093
-- (stock por depósito + portal), así queda completo corra o no 0093 antes.
-- Append-only e idempotente.

alter table public.products
  add column if not exists portal_visible boolean not null default true;

-- ── portal_catalog_all: solo publicados ──────────────────────────────────────
drop function if exists public.portal_catalog_all(uuid, uuid, uuid);
create or replace function public.portal_catalog_all(p_org uuid, p_list uuid, p_warehouse uuid)
returns table(
  id uuid, name text, price numeric, promo numeric, public_price numeric,
  image_path text, stock numeric, featured boolean,
  main_category_id uuid, category_id uuid, season_id uuid, sizes text[], sku bigint
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
    where p.organization_id = p_org and p.active = true and p.portal_visible = true
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
         and s.warehouse_id = p_warehouse and (s.quantity - coalesce(s.reserved, 0)) > 0) as sizes,
    (select max(nullif(regexp_replace(v.sku, '[^0-9]', '', 'g'), '')::bigint)
       from public.product_variants v
       where v.product_id = b.id and v.sku is not null) as sku
  from base b
  where b.stock > 0
  order by b.name;
$$;

-- ── portal_catalog (paginado, con promo): solo publicados ─────────────────────
drop function if exists public.portal_catalog(uuid, uuid, uuid, uuid, text, boolean, integer, integer, uuid, uuid, text);
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
) returns table(id uuid, name text, has_image boolean, price numeric, promo numeric, stock numeric, featured boolean, total bigint)
language sql stable security definer set search_path = public as $$
  with base as (
    select p.id, p.name, p.has_image, pli.price, pli.promo_price as promo, p.featured,
      coalesce((
        select sum(greatest(s.quantity - coalesce(s.reserved, 0), 0))
        from public.stock s
        join public.product_variants v on v.id = s.variant_id
        where v.product_id = p.id and v.active = true and s.warehouse_id = p_warehouse
      ), 0) as stock
    from public.products p
    join public.price_list_items pli
      on pli.product_id = p.id and pli.variant_id is null and pli.price_list_id = p_list
    where p.organization_id = p_org and p.active = true and p.portal_visible = true
      and (p_category is null or p.category_id = p_category)
      and (p_main_category is null or p.main_category_id = p_main_category)
      and (p_season is null or p.season_id = p_season)
      and (p_search is null or p_search = '' or p.name ilike '%' || p_search || '%')
      and (p_featured = false or p.featured = true)
  )
  select id, name, has_image, price, promo, stock, featured, count(*) over() as total
  from base
  where stock > 0
  order by
    (case when p_sort = 'price_asc'  then (case when promo is not null and promo < price then promo else price end) end) asc  nulls last,
    (case when p_sort = 'price_desc' then (case when promo is not null and promo < price then promo else price end) end) desc nulls last,
    name
  limit greatest(1, p_limit) offset greatest(0, p_offset);
$$;

-- ── portal_facets: solo publicados ───────────────────────────────────────────
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
    where p.organization_id = p_org and p.active = true and p.portal_visible = true
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

-- ── update_products: superset (stock por depósito + columna `portal`) ─────────
drop function if exists public.update_products(jsonb);
drop function if exists public.update_products(jsonb, uuid);
create or replace function public.update_products(p_rows jsonb, p_warehouse uuid default null)
returns jsonb language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_el jsonb; v_sku text; v_variant uuid; v_product uuid;
  v_txt text; v_bool boolean; v_id uuid;
  v_updated int := 0; v_nomatch int := 0; v_prods uuid[] := '{}';
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not public.has_perm('productos', true) then raise exception 'No tenés permiso para editar productos'; end if;

  for v_el in select e from jsonb_array_elements(p_rows) as e loop
    v_sku := nullif(btrim(v_el->>'sku'), '');
    if v_sku is null then continue; end if;
    select id, product_id into v_variant, v_product from public.product_variants where organization_id = v_org and sku = v_sku;
    if v_variant is null then v_nomatch := v_nomatch + 1; continue; end if;

    -- ── Producto ──
    v_txt := nullif(btrim(v_el->>'producto'), '');       if v_txt is not null then update public.products set name = v_txt where id = v_product; end if;
    v_txt := nullif(btrim(v_el->>'descripcion'), '');    if v_txt is not null then update public.products set description = v_txt where id = v_product; end if;

    v_txt := nullif(btrim(v_el->>'categoria_principal'), '');
    if v_txt is not null then
      select id into v_id from public.main_categories where organization_id = v_org and lower(name) = lower(v_txt);
      if v_id is null then insert into public.main_categories(organization_id, name) values(v_org, v_txt) returning id into v_id; end if;
      update public.products set main_category_id = v_id where id = v_product;
    end if;
    v_txt := nullif(btrim(v_el->>'categoria'), '');
    if v_txt is not null then
      select id into v_id from public.categories where organization_id = v_org and lower(name) = lower(v_txt);
      if v_id is null then insert into public.categories(organization_id, name) values(v_org, v_txt) returning id into v_id; end if;
      update public.products set category_id = v_id where id = v_product;
    end if;
    v_txt := nullif(btrim(v_el->>'temporada'), '');
    if v_txt is not null then
      select id into v_id from public.seasons where organization_id = v_org and lower(name) = lower(v_txt);
      if v_id is null then insert into public.seasons(organization_id, name) values(v_org, v_txt) returning id into v_id; end if;
      update public.products set season_id = v_id where id = v_product;
    end if;
    v_txt := nullif(btrim(v_el->>'tela'), '');
    if v_txt is not null then
      select id into v_id from public.fabric_types where organization_id = v_org and lower(name) = lower(v_txt);
      if v_id is null then insert into public.fabric_types(organization_id, name) values(v_org, v_txt) returning id into v_id; end if;
      update public.products set fabric_type_id = v_id where id = v_product;
    end if;

    v_txt := btrim(coalesce(v_el->>'iva', ''));
    if v_txt ~ '^[0-9]+(\.[0-9]+)?$' then update public.products set tax_rate = v_txt::numeric where id = v_product; end if;

    v_bool := public._parse_bool(v_el->>'activo');      if v_bool is not null then update public.products set active = v_bool where id = v_product; end if;
    v_bool := public._parse_bool(v_el->>'destacado');   if v_bool is not null then update public.products set featured = v_bool where id = v_product; end if;
    v_bool := public._parse_bool(v_el->>'portal');      if v_bool is not null then update public.products set portal_visible = v_bool where id = v_product; end if;

    v_txt := lower(nullif(btrim(v_el->>'estado'), ''));
    if v_txt is not null then update public.products set lifecycle = case when v_txt like 'discont%' then 'discontinuo' else 'actual' end where id = v_product; end if;

    -- ── Variante ──
    v_txt := nullif(btrim(v_el->>'talle'), '');
    if v_txt is not null then insert into public.sizes(organization_id, name) values(v_org, v_txt) on conflict (organization_id, name) do nothing; update public.product_variants set size = v_txt where id = v_variant; end if;
    v_txt := nullif(btrim(v_el->>'color'), '');
    if v_txt is not null then insert into public.colors(organization_id, name) values(v_org, v_txt) on conflict (organization_id, name) do nothing; update public.product_variants set color = v_txt where id = v_variant; end if;
    v_txt := nullif(btrim(v_el->>'codigo_barras'), ''); if v_txt is not null then update public.product_variants set barcode = v_txt where id = v_variant; end if;
    v_bool := public._parse_bool(v_el->>'variante_activa'); if v_bool is not null then update public.product_variants set active = v_bool where id = v_variant; end if;

    v_txt := btrim(coalesce(v_el->>'fila', ''));     if v_txt ~ '^-?[0-9]+(\.[0-9]+)?$' then update public.product_variants set loc_fila = floor(v_txt::numeric)::int where id = v_variant; end if;
    v_txt := btrim(coalesce(v_el->>'estante', ''));  if v_txt ~ '^-?[0-9]+(\.[0-9]+)?$' then update public.product_variants set loc_estante = floor(v_txt::numeric)::int where id = v_variant; end if;
    v_txt := btrim(coalesce(v_el->>'cubiculo', '')); if v_txt ~ '^-?[0-9]+(\.[0-9]+)?$' then update public.product_variants set loc_cubiculo = floor(v_txt::numeric)::int where id = v_variant; end if;

    -- ── Precios ──
    v_txt := btrim(coalesce(v_el->>'precio_mayorista', ''));
    if v_txt ~ '^[0-9]+(\.[0-9]+)?$' and v_txt::numeric > 0 then perform public.apply_product_pricing(v_product, v_txt::numeric); end if;
    v_txt := btrim(coalesce(v_el->>'precio_publico', ''));
    if v_txt ~ '^[0-9]+(\.[0-9]+)?$' then perform public.set_precio_publico(v_product, v_txt::numeric); end if;

    -- ── Stock del depósito elegido (reemplaza; celda vacía = no toca) ──
    if p_warehouse is not null then
      v_txt := btrim(coalesce(v_el->>'stock', ''));
      if v_txt ~ '^-?[0-9]+(\.[0-9]+)?$' then
        insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
        values (v_org, p_warehouse, v_variant, greatest(floor(v_txt::numeric)::int, 0))
        on conflict (warehouse_id, variant_id) do update set quantity = excluded.quantity, updated_at = now();
      end if;
    end if;

    v_updated := v_updated + 1;
    if not (v_product = any(v_prods)) then v_prods := array_append(v_prods, v_product); end if;
  end loop;

  return jsonb_build_object('actualizados', v_updated, 'productos', coalesce(array_length(v_prods, 1), 0), 'sin_match', v_nomatch);
end $$;

notify pgrst, 'reload schema';
