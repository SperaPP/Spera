-- 0059_import_productos_robusto.sql — import de productos tolerante a valores sucios.
--
-- La 0058 casteaba precio/stock/ubicaciones a número directo; un "#N/A" u otro
-- texto (o un decimal en un campo entero) rompía el lote entero. Ahora se parsean
-- de forma segura: si el valor no es numérico, se ignora (precio/ubicación → null,
-- stock → 0) en vez de abortar.
-- Append-only e idempotente.
create or replace function public.import_products(p_rows jsonb, p_warehouse uuid)
returns jsonb language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_pname text; v_first jsonb; v_el jsonb; v_name text;
  v_maincat uuid; v_cat uuid; v_season uuid; v_fabric uuid;
  v_has_size boolean; v_has_color boolean; v_vartype text; v_dest boolean;
  v_desc text; v_price numeric; v_product uuid; v_variant uuid;
  v_talle text; v_color text; v_sku text; v_stock integer;
  v_fila int; v_est int; v_cub int;
  v_prods int := 0; v_vars int := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_warehouse is null then raise exception 'Elegí el depósito para el stock inicial'; end if;

  for v_pname in
    select distinct trim(e->>'producto') from jsonb_array_elements(p_rows) e
    where nullif(trim(e->>'producto'), '') is not null
  loop
    select e into v_first from jsonb_array_elements(p_rows) with ordinality t(e, ord)
      where trim(e->>'producto') = v_pname order by ord limit 1;

    v_maincat := null; v_name := nullif(trim(v_first->>'categoria_principal'), '');
    if v_name is not null then
      select id into v_maincat from public.main_categories where organization_id = v_org and lower(name) = lower(v_name);
      if v_maincat is null then insert into public.main_categories (organization_id, name) values (v_org, v_name) returning id into v_maincat; end if;
    end if;
    v_cat := null; v_name := nullif(trim(v_first->>'categoria'), '');
    if v_name is not null then
      select id into v_cat from public.categories where organization_id = v_org and lower(name) = lower(v_name);
      if v_cat is null then insert into public.categories (organization_id, name) values (v_org, v_name) returning id into v_cat; end if;
    end if;
    v_season := null; v_name := nullif(trim(v_first->>'temporada'), '');
    if v_name is not null then
      select id into v_season from public.seasons where organization_id = v_org and lower(name) = lower(v_name);
      if v_season is null then insert into public.seasons (organization_id, name) values (v_org, v_name) returning id into v_season; end if;
    end if;
    v_fabric := null; v_name := nullif(trim(v_first->>'tela'), '');
    if v_name is not null then
      select id into v_fabric from public.fabric_types where organization_id = v_org and lower(name) = lower(v_name);
      if v_fabric is null then insert into public.fabric_types (organization_id, name) values (v_org, v_name) returning id into v_fabric; end if;
    end if;

    select bool_or(nullif(trim(e->>'talle'), '') is not null), bool_or(nullif(trim(e->>'color'), '') is not null)
      into v_has_size, v_has_color
    from jsonb_array_elements(p_rows) e where trim(e->>'producto') = v_pname;
    v_vartype := case when v_has_size and v_has_color then 'size_color'
                      when v_has_size then 'size' when v_has_color then 'color' else 'none' end;

    v_desc := nullif(trim(v_first->>'descripcion'), '');
    v_dest := lower(coalesce(trim(v_first->>'destacado'), '')) in ('1', 'si', 'sí', 's', 'x', 'true', 'verdadero', 'y', 'yes', 'sim');

    insert into public.products (organization_id, name, description, category_id, main_category_id, season_id, fabric_type_id, brand, variation_type, tax_rate, lifecycle, active, featured)
    values (v_org, v_pname, v_desc, v_cat, v_maincat, v_season, v_fabric, 'Bodysculpt', v_vartype, 21, 'actual', true, v_dest)
    returning id into v_product;
    v_prods := v_prods + 1;

    for v_el in select e from jsonb_array_elements(p_rows) with ordinality t(e, ord)
                where trim(e->>'producto') = v_pname order by ord
    loop
      v_sku := nullif(trim(v_el->>'sku'), '');
      if v_sku is null then continue; end if;
      if exists (select 1 from public.product_variants where organization_id = v_org and sku = v_sku) then
        raise exception 'El SKU % está repetido (ya existe o está dos veces en el archivo)', v_sku;
      end if;

      v_talle := nullif(trim(v_el->>'talle'), '');
      v_color := nullif(trim(v_el->>'color'), '');
      if v_talle is not null then insert into public.sizes (organization_id, name) values (v_org, v_talle) on conflict (organization_id, name) do nothing; end if;
      if v_color is not null then insert into public.colors (organization_id, name) values (v_org, v_color) on conflict (organization_id, name) do nothing; end if;

      -- Parseo seguro: si no es numérico, se ignora (no rompe el lote).
      v_fila := case when trim(coalesce(v_el->>'fila', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then floor(trim(v_el->>'fila')::numeric)::int else null end;
      v_est  := case when trim(coalesce(v_el->>'estante', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then floor(trim(v_el->>'estante')::numeric)::int else null end;
      v_cub  := case when trim(coalesce(v_el->>'cubiculo', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then floor(trim(v_el->>'cubiculo')::numeric)::int else null end;

      insert into public.product_variants (organization_id, product_id, size, color, sku, barcode, active, loc_fila, loc_estante, loc_cubiculo)
      values (v_org, v_product, v_talle, v_color, v_sku, v_sku, true, v_fila, v_est, v_cub)
      returning id into v_variant;
      v_vars := v_vars + 1;

      v_stock := case when trim(coalesce(v_el->>'stock', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then floor(trim(v_el->>'stock')::numeric)::int else 0 end;
      if v_stock <> 0 then
        insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
        values (v_org, p_warehouse, v_variant, v_stock)
        on conflict (warehouse_id, variant_id) do update set quantity = public.stock.quantity + v_stock, updated_at = now();
      end if;
    end loop;

    -- Precio: primer valor NUMÉRICO del producto (ignora #N/A y texto).
    select trim(e->>'precio_mayorista')::numeric into v_price
    from jsonb_array_elements(p_rows) e
    where trim(e->>'producto') = v_pname and trim(coalesce(e->>'precio_mayorista', '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
    limit 1;
    if v_price is not null and v_price > 0 then
      perform public.apply_product_pricing(v_product, v_price);
    end if;
  end loop;

  return jsonb_build_object('productos', v_prods, 'variantes', v_vars);
end; $$;
