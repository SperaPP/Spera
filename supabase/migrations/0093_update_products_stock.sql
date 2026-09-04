-- 0093_update_products_stock.sql — la actualización masiva también actualiza stock
-- del depósito elegido.
--
-- update_products gana p_warehouse: si viene y la fila trae un valor numérico en
-- 'stock', se fija la existencia de esa variante en ESE depósito (reemplaza, como
-- el import de stock). Celda vacía = no toca el stock. p_warehouse null = no toca
-- stock (comportamiento anterior). Se dropea la firma previa (1 arg) para recrear.
-- Resto idéntico a 0090. Append-only e idempotente.

drop function if exists public.update_products(jsonb);

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
