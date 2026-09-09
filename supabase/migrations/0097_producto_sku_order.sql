-- 0097_producto_sku_order.sql — ordenar productos por SKU (más nuevo primero).
--
-- Los productos nuevos tienen SKU más alto, así que ordenar por el mayor SKU
-- numérico de sus variantes = los más nuevos arriba (más confiable que created_at,
-- que quedó igualado por importaciones masivas).
--
-- products.sku_order = max SKU numérico de las variantes del producto. Se mantiene
-- por trigger ante alta/baja/cambio de SKU de variantes, y se backfillea ahora.
-- Append-only e idempotente.

alter table public.products add column if not exists sku_order bigint;

-- Mayor SKU numérico de un producto (ignora SKUs no numéricos → null).
create or replace function public._max_sku_order(p_product uuid)
returns bigint language sql stable as $$
  select max(nullif(regexp_replace(v.sku, '[^0-9]', '', 'g'), '')::bigint)
  from public.product_variants v where v.product_id = p_product;
$$;

-- Backfill inicial.
update public.products p set sku_order = public._max_sku_order(p.id);

-- Trigger: recalcular sku_order cuando cambian las variantes.
create or replace function public.trg_variant_sku_order()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    update public.products set sku_order = public._max_sku_order(old.product_id) where id = old.product_id;
    return old;
  end if;
  update public.products set sku_order = public._max_sku_order(new.product_id) where id = new.product_id;
  if tg_op = 'UPDATE' and new.product_id <> old.product_id then
    update public.products set sku_order = public._max_sku_order(old.product_id) where id = old.product_id;
  end if;
  return new;
end $$;

drop trigger if exists variant_sku_order on public.product_variants;
create trigger variant_sku_order
  after insert or delete or update of sku, product_id on public.product_variants
  for each row execute function public.trg_variant_sku_order();

create index if not exists products_sku_order_idx
  on public.products (organization_id, sku_order desc nulls last);

notify pgrst, 'reload schema';
