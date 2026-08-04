-- 0015_productos_gestion.sql — Cierre del módulo Productos:
--  • products.has_image (mantenido por trigger) → columna/filtro "sin foto".
--  • create_product acepta SKU opcional por variante (si no viene, correlativo).
--  • add_variant / delete_variant para gestionar variantes.
-- Append-only e idempotente.

-- ── has_image en products ────────────────────────────────────
alter table public.products add column if not exists has_image boolean not null default false;

create or replace function public.sync_product_has_image() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.products set has_image = true where id = new.product_id;
  elsif tg_op = 'DELETE' then
    update public.products
      set has_image = exists (select 1 from public.product_images where product_id = old.product_id)
      where id = old.product_id;
  end if;
  return null;
end; $$;

drop trigger if exists product_images_sync_has_image on public.product_images;
create trigger product_images_sync_has_image
  after insert or delete on public.product_images
  for each row execute function public.sync_product_has_image();

-- Backfill de los productos que ya tienen fotos.
update public.products p
  set has_image = exists (select 1 from public.product_images pi where pi.product_id = p.id)
  where p.has_image is distinct from exists (select 1 from public.product_images pi where pi.product_id = p.id);

-- ── create_product: SKU opcional por variante ────────────────
create or replace function public.create_product(
  p_name           text,
  p_description    text,
  p_category_id    uuid,
  p_fabric_type_id uuid,
  p_variation_type text,
  p_tax_rate       numeric,
  p_variants       jsonb,   -- [{ size, color, sku?, stock }]  (sku opcional; si viene, se respeta)
  p_warehouse_id   uuid,
  p_prices         jsonb
) returns uuid
language plpgsql
as $$
declare
  v_org uuid := public.current_org_id();
  v_product uuid; v_variant uuid; v_el jsonb; v_sku text; v_stock integer;
begin
  if v_org is null then raise exception 'Sin organización en el contexto'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'El nombre es obligatorio'; end if;

  insert into public.products
    (organization_id, name, description, category_id, fabric_type_id, brand, variation_type, tax_rate)
  values
    (v_org, trim(p_name), nullif(trim(coalesce(p_description,'')),''), p_category_id, p_fabric_type_id,
     'Bodysculpt', coalesce(nullif(p_variation_type,''),'none'), coalesce(p_tax_rate,21))
  returning id into v_product;

  for v_el in select e from jsonb_array_elements(coalesce(p_variants,'[]'::jsonb)) as e
  loop
    v_sku := nullif(trim(coalesce(v_el->>'sku','')), '');
    if v_sku is null then
      v_sku := nextval('public.sku_seq')::text;
    elsif exists (select 1 from public.product_variants where organization_id = v_org and sku = v_sku) then
      raise exception 'El SKU % ya existe', v_sku;
    end if;

    insert into public.product_variants (organization_id, product_id, size, color, sku, barcode)
    values (v_org, v_product,
            nullif(trim(coalesce(v_el->>'size','')),''),
            nullif(trim(coalesce(v_el->>'color','')),''),
            v_sku, v_sku)
    returning id into v_variant;

    v_stock := coalesce(nullif(v_el->>'stock','')::integer, 0);
    if v_stock <> 0 and p_warehouse_id is not null then
      insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
      values (v_org, p_warehouse_id, v_variant, v_stock)
      on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + excluded.quantity, updated_at = now();
      insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_warehouse_id, v_variant, v_stock, 'ingreso', 'product_create', v_product, auth.uid());
    end if;
  end loop;

  for v_el in select e from jsonb_array_elements(coalesce(p_prices,'[]'::jsonb)) as e
  loop
    if nullif(trim(coalesce(v_el->>'price','')),'') is not null then
      insert into public.price_list_items (organization_id, price_list_id, product_id, variant_id, price)
      values (v_org, (v_el->>'price_list_id')::uuid, v_product, null, (v_el->>'price')::numeric);
    end if;
  end loop;

  return v_product;
end;
$$;

-- ── Agregar una variante a un producto existente ─────────────
create or replace function public.add_variant(
  p_product_id   uuid,
  p_size         text,
  p_color        text,
  p_sku          text,
  p_stock        integer,
  p_warehouse_id uuid
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_sku text; v_variant uuid; v_size text; v_color text;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not exists (select 1 from public.products where id = p_product_id and organization_id = v_org) then
    raise exception 'Producto inválido';
  end if;

  v_size  := nullif(trim(coalesce(p_size,'')),'');
  v_color := nullif(trim(coalesce(p_color,'')),'');
  if exists (select 1 from public.product_variants where product_id = p_product_id
             and coalesce(size,'') = coalesce(v_size,'') and coalesce(color,'') = coalesce(v_color,'')) then
    raise exception 'Esa combinación de talle/color ya existe en el producto';
  end if;

  v_sku := nullif(trim(coalesce(p_sku,'')),'');
  if v_sku is null then
    v_sku := nextval('public.sku_seq')::text;
  elsif exists (select 1 from public.product_variants where organization_id = v_org and sku = v_sku) then
    raise exception 'El SKU % ya existe', v_sku;
  end if;

  insert into public.product_variants (organization_id, product_id, size, color, sku, barcode)
  values (v_org, p_product_id, v_size, v_color, v_sku, v_sku)
  returning id into v_variant;

  if coalesce(p_stock,0) <> 0 and p_warehouse_id is not null then
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, p_warehouse_id, v_variant, p_stock)
    on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + excluded.quantity, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, p_warehouse_id, v_variant, p_stock, 'ingreso', 'variant_add', v_variant, auth.uid());
  end if;

  return v_variant;
end; $$;

-- ── Borrar una variante (solo si nunca se usó) ───────────────
create or replace function public.delete_variant(p_variant_id uuid) returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not exists (select 1 from public.product_variants where id = p_variant_id and organization_id = v_org) then
    raise exception 'Variante inválida';
  end if;
  if exists (select 1 from public.sale_items where variant_id = p_variant_id)
     or exists (select 1 from public.return_items where variant_id = p_variant_id)
     or exists (select 1 from public.stock_transfer_items where variant_id = p_variant_id) then
    raise exception 'La variante tiene movimientos (ventas/devoluciones/transferencias): desactivala en lugar de borrarla';
  end if;

  delete from public.stock_movements where variant_id = p_variant_id;
  delete from public.stock where variant_id = p_variant_id;
  delete from public.price_list_items where variant_id = p_variant_id;
  delete from public.product_variants where id = p_variant_id;
end; $$;
