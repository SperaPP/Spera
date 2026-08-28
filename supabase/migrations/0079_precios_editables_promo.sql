-- 0079_precios_editables_promo.sql — listas editables + precio promocional.
--
-- Cambios:
--  1) Publico se DESACOPLA de la fórmula: sigue existiendo el ×2, pero pasa a ser
--     editable/importable a mano. `apply_product_pricing` ya NO pisa un Publico
--     existente al cambiar Mayorista: solo lo INICIALIZA (=×2) si el producto aún
--     no tiene Publico. El ×2 masivo queda como acción explícita (recalc_all_pricing,
--     el botón "Recalcular Publico desde Mayorista").
--  2) Precio promocional por (lista, producto): columna `promo_price`. Si está
--     cargado y es menor al precio de lista, es la oferta vigente (se cobra la promo
--     y se muestra el precio de lista tachado). Manual: se prende/apaga a mano.
--     Independiente por lista (Mayorista y Publico pueden tener promos distintas).
--
-- Append-only e idempotente.

-- ── 1. Columna de precio promocional ─────────────────────────
alter table public.price_list_items
  add column if not exists promo_price numeric;
do $$ begin
  alter table public.price_list_items
    add constraint price_list_items_promo_nonneg check (promo_price is null or promo_price >= 0);
exception when duplicate_object then null; end $$;

-- ── 2. apply_product_pricing: no pisa Publico existente ───────
create or replace function public.apply_product_pricing(p_product_id uuid, p_base numeric default null)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_base numeric; v_lmay uuid; v_lpub uuid; v_has_pub boolean;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select id into v_lmay from public.price_lists where organization_id = v_org and name = 'Mayorista';
  select id into v_lpub from public.price_lists where organization_id = v_org and name = 'Publico';
  if v_lmay is null or v_lpub is null then raise exception 'Faltan listas de precios (Mayorista/Publico)'; end if;

  v_base := p_base;
  if v_base is null then
    select price into v_base from public.price_list_items
      where price_list_id = v_lmay and product_id = p_product_id and variant_id is null;
  end if;
  if v_base is null then return; end if;  -- sin base, nada que hacer

  v_base := round(v_base);
  perform public._store_price(v_org, v_lmay, p_product_id, v_base);

  -- Publico ya NO se pisa: solo se inicializa (=×2) si el producto aún no lo tiene.
  select exists(
    select 1 from public.price_list_items
    where price_list_id = v_lpub and product_id = p_product_id and variant_id is null
  ) into v_has_pub;
  if not v_has_pub then
    perform public._store_price(v_org, v_lpub, p_product_id, round(v_base * 2));
  end if;
end $$;

-- ── 3. set_precio_publico: edición manual de Publico ─────────
create or replace function public.set_precio_publico(p_product_id uuid, p_price numeric)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_lpub uuid;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_price is null or p_price < 0 then raise exception 'Precio inválido'; end if;
  select id into v_lpub from public.price_lists where organization_id = v_org and name = 'Publico';
  if v_lpub is null then raise exception 'Falta la lista Publico'; end if;
  perform public._store_price(v_org, v_lpub, p_product_id, round(p_price));
end $$;

-- ── 4. recalc_all_pricing: FUERZA Publico = Mayorista × 2 ─────
-- (Botón "Recalcular Publico desde Mayorista": pisa el Publico de todos los
--  productos con Mayorista cargado. Es la única vía de re-derivar en masa.)
create or replace function public.recalc_all_pricing()
returns integer language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_lmay uuid; v_lpub uuid; r record; n int := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select id into v_lmay from public.price_lists where organization_id = v_org and name = 'Mayorista';
  select id into v_lpub from public.price_lists where organization_id = v_org and name = 'Publico';
  if v_lmay is null or v_lpub is null then raise exception 'Faltan listas (Mayorista/Publico)'; end if;
  for r in select product_id, price from public.price_list_items where price_list_id = v_lmay and variant_id is null loop
    perform public._store_price(v_org, v_lpub, r.product_id, round(r.price * 2));  -- forzado
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── 5. set_promo_price: prende/apaga la promo de (lista, producto) ─
create or replace function public.set_promo_price(p_list uuid, p_product uuid, p_promo numeric)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_promo is null then
    update public.price_list_items set promo_price = null, updated_at = now()
      where organization_id = v_org and price_list_id = p_list and product_id = p_product and variant_id is null;
    return;
  end if;
  if p_promo < 0 then raise exception 'La promo no puede ser negativa'; end if;
  update public.price_list_items set promo_price = round(p_promo), updated_at = now()
    where organization_id = v_org and price_list_id = p_list and product_id = p_product and variant_id is null;
  if not found then
    raise exception 'El producto no tiene precio en esa lista; cargá el precio antes de poner promo';
  end if;
end $$;

-- ── 6. portal_catalog: devuelve también la promo ─────────────
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
    where p.organization_id = p_org and p.active = true
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
    -- Ordena por el precio EFECTIVO (promo si aplica, si no el de lista).
    (case when p_sort = 'price_asc'  then (case when promo is not null and promo < price then promo else price end) end) asc  nulls last,
    (case when p_sort = 'price_desc' then (case when promo is not null and promo < price then promo else price end) end) desc nulls last,
    name
  limit greatest(1, p_limit) offset greatest(0, p_offset);
$$;
