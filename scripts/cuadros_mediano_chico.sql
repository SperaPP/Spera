-- cuadros_mediano_chico.sql — Operación de datos (Bodysculpt / Spera), 27/10/2026.
-- NO es una migración. Correr UNA vez en el SQL Editor de Supabase. Todo en una sola
-- transacción: si algún control falla, no se aplica NADA.
--
-- Qué hace, para cada producto de la categoría "Cuadros" (39):
--   1) MEDIANO: el producto existente pasa a llamarse "Cuadro X Mediano" y queda SIMPLE
--      (variation_type none, una sola variante sin talle/color). Se conserva la variante
--      "Mediano" o la sin medida si existía (mismo SKU, mismo stock, mismo historial); si
--      no había, se crea una variante nueva con SKU nuevo y stock 0. Precios: no cambian
--      (Mayorista $100.000 · Público $200.000 con promo $140.000).
--   2) CHICO: se crea "Cuadro X Chico", producto simple con SKU nuevo, mismas categorías,
--      fotos (filas copiadas, mismo archivo) y visibilidad en el portal. Precios: Mayorista
--      $90.000 · Público $180.000 (tachado) con promo $130.000. Su stock = el que tenía la
--      variante Chico vieja, en el mismo depósito, con movimiento de stock registrado.
--   3) Las variantes Chico y Grande viejas se DESACTIVAN (no se borran: tienen ventas e
--      historial). Grande conserva su stock "congelado" (no se ve ni se vende).
--   4) Tiendanube no cambia: el vínculo de la variante Chico vieja pasa a la Chico nueva
--      (el stock se mueve con él, TN sigue viendo la misma cantidad); Grande no se toca.
-- Idempotente: los productos que ya terminan en "Mediano"/"Chico" se saltean.

begin;

do $$
declare
  v_org uuid := 'a9695a41-4c61-4680-bfee-68a0c3af32a8';
  v_cat uuid; v_may uuid; v_pub uuid;
  p record; s record;
  v_keep uuid; v_keep_color text; v_chico_old uuid;
  v_new_prod uuid; v_new_var uuid; v_sku text;
  n_prod int := 0; n_med_nueva int := 0; n_mov int := 0; n_unid int := 0;
  v_total_antes bigint; v_total_despues bigint;
begin
  select id into v_cat from public.categories where organization_id = v_org and name = 'Cuadros';
  select id into v_may from public.price_lists where organization_id = v_org and name = 'Mayorista';
  select id into v_pub from public.price_lists where organization_id = v_org and name = 'Publico';
  if v_cat is null or v_may is null or v_pub is null then raise exception 'Falta la categoría Cuadros o una lista de precios'; end if;

  -- Control: stock físico total de los cuadros antes (no se puede perder ni crear stock).
  select coalesce(sum(st.quantity), 0) into v_total_antes
  from public.stock st join public.product_variants pv on pv.id = st.variant_id
  join public.products pr on pr.id = pv.product_id
  where pr.organization_id = v_org and pr.category_id = v_cat;

  for p in
    select * from public.products
    where organization_id = v_org and category_id = v_cat and active
      and name !~* '\m(mediano|chico)\s*$'
    order by name
  loop
    n_prod := n_prod + 1;

    -- (1) Variante que queda como MEDIANO: la "Mediano", o la sin medida, o una de otro
    --     color (p. ej. NARANJA). Nunca una Chico/Grande.
    v_keep := null;
    select id, color into v_keep, v_keep_color from public.product_variants
    where product_id = p.id and active and lower(coalesce(color, '')) not in ('chico', 'grande')
    order by case when lower(coalesce(color, '')) = 'mediano' then 0
                  when color is null and size is null then 1 else 2 end, created_at
    limit 1;
    if v_keep is null then
      loop
        v_sku := nextval('public.sku_seq')::text;
        exit when not exists (select 1 from public.product_variants where organization_id = v_org and sku = v_sku);
      end loop;
      insert into public.product_variants (organization_id, product_id, size, color, sku, barcode)
      values (v_org, p.id, null, null, v_sku, v_sku) returning id into v_keep;
      n_med_nueva := n_med_nueva + 1;
    else
      update public.product_variants set size = null, color = null where id = v_keep;
    end if;

    -- (2) Producto CHICO nuevo.
    insert into public.products (organization_id, name, description, category_id, fabric_type_id, brand,
      variation_type, tax_rate, active, lifecycle, featured, tn_sync, main_category_id, season_id,
      portal_visible, has_image)
    values (v_org, p.name || ' Chico', p.description, p.category_id, p.fabric_type_id, p.brand,
      'none', p.tax_rate, true, p.lifecycle, p.featured, false, p.main_category_id, p.season_id,
      p.portal_visible, p.has_image)
    returning id into v_new_prod;

    loop
      v_sku := nextval('public.sku_seq')::text;
      exit when not exists (select 1 from public.product_variants where organization_id = v_org and sku = v_sku);
    end loop;
    insert into public.product_variants (organization_id, product_id, size, color, sku, barcode)
    values (v_org, v_new_prod, null, null, v_sku, v_sku) returning id into v_new_var;

    insert into public.product_images (organization_id, product_id, path, color, position, is_primary)
    select organization_id, v_new_prod, path, null, position, is_primary
    from public.product_images where product_id = p.id;
    -- Las fotos del mediano dejan de estar atadas a un "color" que ya no existe.
    update public.product_images set color = null where product_id = p.id and color is not null;

    insert into public.price_list_items (organization_id, price_list_id, product_id, variant_id, price, promo_price)
    values (v_org, v_may, v_new_prod, null, 90000, null),
           (v_org, v_pub, v_new_prod, null, 180000, 130000);

    -- (3) Stock de la variante Chico vieja → Chico nuevo (mismo depósito). El vínculo con
    --     TN se mueve ANTES, así el sync empuja al TN la misma cantidad (no un 0).
    v_chico_old := null;
    select id into v_chico_old from public.product_variants
    where product_id = p.id and lower(coalesce(color, '')) = 'chico'
    order by active desc, created_at limit 1;
    if v_chico_old is not null then
      update public.tiendanube_links set variant_id = v_new_var
      where variant_id = v_chico_old
        and not exists (select 1 from public.tiendanube_links x where x.variant_id = v_new_var);
      for s in select * from public.stock where variant_id = v_chico_old and quantity > 0 loop
        if coalesce(s.reserved, 0) > 0 then
          raise exception 'El cuadro % tiene unidades Chico reservadas en un pedido: resolver antes', p.name;
        end if;
        update public.stock set quantity = 0, updated_at = now() where id = s.id;
        insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id)
        values (v_org, s.warehouse_id, v_chico_old, -s.quantity, 'ajuste', 'reestructura_cuadros', v_new_prod);
        insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
        values (v_org, s.warehouse_id, v_new_var, s.quantity)
        on conflict (warehouse_id, variant_id) do update set quantity = public.stock.quantity + excluded.quantity, updated_at = now();
        insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id)
        values (v_org, s.warehouse_id, v_new_var, s.quantity, 'ajuste', 'reestructura_cuadros', p.id);
        n_mov := n_mov + 1; n_unid := n_unid + s.quantity;
      end loop;
    end if;

    -- (4) Todas las demás variantes (Chico/Grande viejas) se desactivan. Mediano queda simple.
    update public.product_variants set active = false where product_id = p.id and id <> v_keep and active;
    update public.products set name = p.name || ' Mediano', variation_type = 'none' where id = p.id;
  end loop;

  -- Controles finales: si algo no cierra, se revierte TODO.
  if n_prod <> 39 then raise exception 'Se esperaban 39 cuadros y se procesaron %', n_prod; end if;
  select coalesce(sum(st.quantity), 0) into v_total_despues
  from public.stock st join public.product_variants pv on pv.id = st.variant_id
  join public.products pr on pr.id = pv.product_id
  where pr.organization_id = v_org and pr.category_id = v_cat;
  if v_total_despues <> v_total_antes then
    raise exception 'El stock total cambió (% → %): se revierte', v_total_antes, v_total_despues;
  end if;
  if exists (select 1 from public.products pr where pr.organization_id = v_org and pr.category_id = v_cat and pr.active
             and (select count(*) from public.product_variants pv where pv.product_id = pr.id and pv.active) <> 1) then
    raise exception 'Quedó algún cuadro con más o menos de una variante activa: se revierte';
  end if;

  raise notice 'OK: % cuadros → % Mediano + % Chico. Medianos con variante nueva: %. Stock Chico movido: % unidades en % depósitos. Stock total sin cambios: %.',
    n_prod, n_prod, n_prod, n_med_nueva, n_unid, n_mov, v_total_despues;
end $$;

commit;
