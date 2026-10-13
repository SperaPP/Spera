-- 0107_stock_imports_seguros.sql — correcciones de la auditoría de stock (#3, #4, #6).
--
-- #3a update_products: la edición masiva de productos DEJA DE TOCAR STOCK. El stock
--     se carga solo por "Importar stock" o la pantalla de stock. Así re-subir una
--     lista de productos nunca pisa el stock real. (Se ignora p_warehouse/columna stock.)
-- #3b import_stock: sigue fijando el stock al valor del archivo, pero NUNCA por debajo
--     de lo reservado (respeta compromisos, no rompe el CHECK) y DEJA MOVIMIENTO.
-- #4  apply_stock_count: ya no baja la reserva en silencio; si el conteo es menor a lo
--     reservado, saltea esa variante (no la toca) en vez de romper la reserva.
-- #6  approve_return: función muerta (apunta a tablas borradas) → se elimina.
-- Append-only e idempotente.

-- ── #6: eliminar función rota ────────────────────────────────
drop function if exists public.approve_return(uuid);

-- ── #3b: import_stock seguro + con registro ──────────────────
create or replace function public.import_stock(p_warehouse uuid, p_rows jsonb)
returns integer language plpgsql as $$
declare v_org uuid := public.current_org_id(); el jsonb; v_variant uuid; v_new int; v_old int; v_res int; v_set int; n int := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_warehouse is null then raise exception 'Elegí el depósito'; end if;
  for el in select e from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as e loop
    if nullif(el->>'cantidad','') is null or (el->>'cantidad') !~ '^-?[0-9]+(\.[0-9]+)?$' then continue; end if;
    v_new := greatest(floor((el->>'cantidad')::numeric)::int, 0);
    select v.id into v_variant from public.product_variants v
      join public.products p on p.id = v.product_id
      where p.organization_id = v_org and v.sku = (el->>'sku') limit 1;
    if v_variant is null then continue; end if;
    select quantity, coalesce(reserved,0) into v_old, v_res from public.stock
      where warehouse_id = p_warehouse and variant_id = v_variant for update;
    v_old := coalesce(v_old, 0); v_res := coalesce(v_res, 0);
    -- nunca por debajo de lo reservado (respeta compromisos, no viola el CHECK)
    v_set := greatest(v_new, v_res);
    if v_set = v_old then continue; end if;
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, p_warehouse, v_variant, v_set)
    on conflict (warehouse_id, variant_id) do update set quantity = v_set, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, p_warehouse, v_variant, v_set - v_old, 'ajuste', 'import', null, auth.uid());
    n := n + 1;
  end loop;
  return n;
end; $$;

-- ── #4: apply_stock_count no borra reservas ──────────────────
create or replace function public.apply_stock_count(p_warehouse_id uuid, p_counts jsonb)
returns integer language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_el jsonb; v_variant uuid; v_new integer; v_old integer; v_res integer; v_delta integer; n integer := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and organization_id = v_org) then
    raise exception 'Depósito inválido'; end if;
  if p_counts is null or jsonb_array_length(p_counts) = 0 then raise exception 'El conteo está vacío'; end if;
  for v_el in select e from jsonb_array_elements(p_counts) as e loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_new := greatest(0, coalesce((v_el->>'quantity')::integer, 0));
    select quantity, coalesce(reserved,0) into v_old, v_res from public.stock
      where warehouse_id = p_warehouse_id and variant_id = v_variant for update;
    v_old := coalesce(v_old, 0); v_res := coalesce(v_res, 0);
    -- Si el conteo es menor a lo reservado, NO tocar esta variante (no romper la reserva).
    if v_new < v_res then continue; end if;
    v_delta := v_new - v_old;
    if v_delta = 0 then continue; end if;
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, p_warehouse_id, v_variant, v_new)
    on conflict (warehouse_id, variant_id) do update set quantity = v_new, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, p_warehouse_id, v_variant, v_delta, 'conteo', 'stock_count', null, auth.uid());
    n := n + 1;
  end loop;
  return n;
end; $$;

-- ── #3a: update_products NO toca stock (se ignora p_warehouse/columna stock) ──
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
  perform p_warehouse; -- ya no se usa: la edición masiva no toca stock (se carga por Importar stock)

  for v_el in select e from jsonb_array_elements(p_rows) as e loop
    v_sku := nullif(btrim(v_el->>'sku'), '');
    if v_sku is null then continue; end if;
    select id, product_id into v_variant, v_product from public.product_variants where organization_id = v_org and sku = v_sku;
    if v_variant is null then v_nomatch := v_nomatch + 1; continue; end if;

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

    v_txt := nullif(btrim(v_el->>'talle'), '');
    if v_txt is not null then insert into public.sizes(organization_id, name) values(v_org, v_txt) on conflict (organization_id, name) do nothing; update public.product_variants set size = v_txt where id = v_variant; end if;
    v_txt := nullif(btrim(v_el->>'color'), '');
    if v_txt is not null then insert into public.colors(organization_id, name) values(v_org, v_txt) on conflict (organization_id, name) do nothing; update public.product_variants set color = v_txt where id = v_variant; end if;
    v_txt := nullif(btrim(v_el->>'codigo_barras'), ''); if v_txt is not null then update public.product_variants set barcode = v_txt where id = v_variant; end if;
    v_bool := public._parse_bool(v_el->>'variante_activa'); if v_bool is not null then update public.product_variants set active = v_bool where id = v_variant; end if;

    v_txt := btrim(coalesce(v_el->>'fila', ''));     if v_txt ~ '^-?[0-9]+(\.[0-9]+)?$' then update public.product_variants set loc_fila = floor(v_txt::numeric)::int where id = v_variant; end if;
    v_txt := btrim(coalesce(v_el->>'estante', ''));  if v_txt ~ '^-?[0-9]+(\.[0-9]+)?$' then update public.product_variants set loc_estante = floor(v_txt::numeric)::int where id = v_variant; end if;
    v_txt := btrim(coalesce(v_el->>'cubiculo', '')); if v_txt ~ '^-?[0-9]+(\.[0-9]+)?$' then update public.product_variants set loc_cubiculo = floor(v_txt::numeric)::int where id = v_variant; end if;

    v_txt := btrim(coalesce(v_el->>'precio_mayorista', ''));
    if v_txt ~ '^[0-9]+(\.[0-9]+)?$' and v_txt::numeric > 0 then perform public.apply_product_pricing(v_product, v_txt::numeric); end if;
    v_txt := btrim(coalesce(v_el->>'precio_publico', ''));
    if v_txt ~ '^[0-9]+(\.[0-9]+)?$' then perform public.set_precio_publico(v_product, v_txt::numeric); end if;

    v_txt := btrim(coalesce(v_el->>'promo_mayorista', ''));
    if v_txt ~ '^[0-9]+(\.[0-9]+)?$' then
      select id into v_id from public.price_lists where organization_id = v_org and name = 'Mayorista';
      if v_id is not null then
        if v_txt::numeric = 0 then perform public.set_promo_price(v_id, v_product, null);
        elsif exists (select 1 from public.price_list_items where price_list_id = v_id and product_id = v_product and variant_id is null) then
          perform public.set_promo_price(v_id, v_product, v_txt::numeric);
        end if;
      end if;
    end if;
    v_txt := btrim(coalesce(v_el->>'promo_publico', ''));
    if v_txt ~ '^[0-9]+(\.[0-9]+)?$' then
      select id into v_id from public.price_lists where organization_id = v_org and name = 'Publico';
      if v_id is not null then
        if v_txt::numeric = 0 then perform public.set_promo_price(v_id, v_product, null);
        elsif exists (select 1 from public.price_list_items where price_list_id = v_id and product_id = v_product and variant_id is null) then
          perform public.set_promo_price(v_id, v_product, v_txt::numeric);
        end if;
      end if;
    end if;

    v_updated := v_updated + 1;
    if not (v_product = any(v_prods)) then v_prods := array_append(v_prods, v_product); end if;
  end loop;

  return jsonb_build_object('actualizados', v_updated, 'productos', coalesce(array_length(v_prods, 1), 0), 'sin_match', v_nomatch);
end $$;

notify pgrst, 'reload schema';
