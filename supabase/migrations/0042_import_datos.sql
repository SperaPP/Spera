-- 0042_import_datos.sql — Import masivo por Excel: stock y ubicaciones (por SKU).
--  import_stock: setea la cantidad (absoluta) de cada variante en un depósito.
--  import_ubicaciones: setea fila/estante/cubículo de cada variante.
--  Corren con el contexto del empleado (current_org_id); matchean por SKU.
-- Append-only e idempotente.

create or replace function public.import_stock(p_warehouse uuid, p_rows jsonb)
returns integer language plpgsql as $$
declare v_org uuid := public.current_org_id(); el jsonb; v_variant uuid; v_qty numeric; n int := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_warehouse is null then raise exception 'Elegí el depósito'; end if;
  for el in select e from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as e
  loop
    v_qty := nullif(el->>'cantidad', '')::numeric;
    if v_qty is null or v_qty < 0 then continue; end if;
    select v.id into v_variant from public.product_variants v
      join public.products p on p.id = v.product_id
      where p.organization_id = v_org and v.sku = (el->>'sku') limit 1;
    if v_variant is null then continue; end if;
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, p_warehouse, v_variant, v_qty)
    on conflict (warehouse_id, variant_id) do update set quantity = excluded.quantity, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end; $$;

create or replace function public.import_ubicaciones(p_rows jsonb)
returns integer language plpgsql as $$
declare v_org uuid := public.current_org_id(); el jsonb; v_variant uuid; n int := 0;
  v_fila smallint; v_est smallint; v_cub smallint;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  for el in select e from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as e
  loop
    select v.id into v_variant from public.product_variants v
      join public.products p on p.id = v.product_id
      where p.organization_id = v_org and v.sku = (el->>'sku') limit 1;
    if v_variant is null then continue; end if;
    v_fila := nullif(el->>'fila', '')::smallint;
    v_est  := nullif(el->>'estante', '')::smallint;
    v_cub  := nullif(el->>'cubiculo', '')::smallint;
    update public.product_variants
      set loc_fila = v_fila, loc_estante = v_est, loc_cubiculo = v_cub
      where id = v_variant;
    n := n + 1;
  end loop;
  return n;
end; $$;
