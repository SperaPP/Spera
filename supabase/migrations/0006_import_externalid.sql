-- 0006_import_externalid.sql — Soporte de importación desde WooCommerce.
-- external_id para idempotencia (re-importar sin duplicar) y ajuste del SKU
-- correlativo de productos NUEVOS para que no pise los SKU de Woo.
-- Append-only e idempotente.

-- ── external_id (id de Woo) en producto y variante ───────────
alter table public.products         add column if not exists external_id     text;
alter table public.products         add column if not exists external_source  text;
alter table public.product_variants add column if not exists external_id     text;

-- Unique NO parcial: permite múltiples NULL (productos creados a mano) y sirve
-- como target de ON CONFLICT en la importación.
create unique index if not exists products_external_uq
  on public.products (organization_id, external_id);
create unique index if not exists product_variants_external_uq
  on public.product_variants (organization_id, external_id);

-- Los SKU de Woo llegan hasta ~252329. Los productos NUEVOS (creados en Spera)
-- arrancan en 300001 para no colisionar nunca con los importados.
select setval('public.sku_seq', 300000, true);

-- RPC: SKU sin padding (mismo formato numérico que Woo). barcode = sku.
create or replace function public.create_product(
  p_name           text,
  p_description    text,
  p_category_id    uuid,
  p_fabric_type_id uuid,
  p_variation_type text,
  p_tax_rate       numeric,
  p_variants       jsonb,
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
    v_sku := nextval('public.sku_seq')::text;
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
      on conflict (warehouse_id, variant_id)
        do update set quantity = stock.quantity + excluded.quantity, updated_at = now();
      insert into public.stock_movements
        (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
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
