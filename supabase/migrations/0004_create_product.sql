-- 0004_create_product.sql — Alta atómica de producto con variantes, stock
-- inicial y precios. Append-only e idempotente.

-- Secuencia para códigos de barra internos (13 dígitos, prefijo "20").
create sequence if not exists public.barcode_seq;

-- Crea el producto, sus variantes (autogenerando barcode si no viene),
-- carga el stock inicial en un depósito y setea precios por lista.
-- Todo en una transacción: si algo falla, no queda nada a medias.
create or replace function public.create_product(
  p_name           text,
  p_category       text,
  p_brand          text,
  p_variation_type text,
  p_tax_rate       numeric,
  p_variants       jsonb,   -- [{ size, color, sku, barcode, stock }]
  p_warehouse_id   uuid,    -- depósito del stock inicial (puede ser null)
  p_prices         jsonb    -- [{ price_list_id, price }]
) returns uuid
language plpgsql
as $$
declare
  v_org     uuid := public.current_org_id();
  v_product uuid;
  v_variant uuid;
  v_el      jsonb;
  v_barcode text;
  v_stock   integer;
begin
  if v_org is null then
    raise exception 'Sin organización en el contexto';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'El nombre es obligatorio';
  end if;

  insert into public.products (organization_id, name, category, brand, variation_type, tax_rate)
  values (v_org, trim(p_name), nullif(trim(coalesce(p_category,'')),''),
          nullif(trim(coalesce(p_brand,'')),''),
          coalesce(nullif(p_variation_type,''),'none'),
          coalesce(p_tax_rate, 21))
  returning id into v_product;

  for v_el in select e from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb)) as e
  loop
    v_barcode := nullif(trim(coalesce(v_el->>'barcode','')), '');
    if v_barcode is null then
      v_barcode := '20' || lpad(nextval('public.barcode_seq')::text, 11, '0');
    end if;

    insert into public.product_variants (organization_id, product_id, size, color, sku, barcode)
    values (v_org, v_product,
            nullif(trim(coalesce(v_el->>'size','')),''),
            nullif(trim(coalesce(v_el->>'color','')),''),
            nullif(trim(coalesce(v_el->>'sku','')),''),
            v_barcode)
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

  for v_el in select e from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) as e
  loop
    if nullif(trim(coalesce(v_el->>'price','')),'') is not null then
      insert into public.price_list_items (organization_id, price_list_id, product_id, variant_id, price)
      values (v_org, (v_el->>'price_list_id')::uuid, v_product, null, (v_el->>'price')::numeric);
    end if;
  end loop;

  return v_product;
end;
$$;
