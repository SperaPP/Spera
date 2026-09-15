-- 0098_delete_product.sql — eliminar un producto del sistema.
--
-- Espeja a delete_variant (0024): solo se puede borrar si NINGUNA de sus variantes
-- tiene movimientos (ventas o transferencias); si los tiene, hay que desactivarlo.
-- stock_movements no cascada, así que se limpia a mano antes; el resto (variantes,
-- stock, precios, fotos, mapeos TN, reposiciones) cae por cascada al borrar el
-- producto. Gateado por permiso 'productos'. Append-only e idempotente.

create or replace function public.delete_product(p_product_id uuid) returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not public.has_perm('productos', true) then raise exception 'No tenés permiso para eliminar productos'; end if;
  if not exists (select 1 from public.products where id = p_product_id and organization_id = v_org) then
    raise exception 'Producto inválido';
  end if;

  if exists (select 1 from public.sale_items si join public.product_variants v on v.id = si.variant_id where v.product_id = p_product_id)
     or exists (select 1 from public.stock_transfer_items ti join public.product_variants v on v.id = ti.variant_id where v.product_id = p_product_id) then
    raise exception 'El producto tiene movimientos (ventas o transferencias). Desactivalo en lugar de eliminarlo.';
  end if;

  -- stock_movements no tiene ON DELETE CASCADE: limpiar antes de borrar el producto.
  delete from public.stock_movements sm using public.product_variants v
    where v.product_id = p_product_id and sm.variant_id = v.id;

  -- Borrar el producto: la cascada elimina variantes, stock, precios, fotos y mapeos.
  delete from public.products where id = p_product_id and organization_id = v_org;
end $$;

notify pgrst, 'reload schema';
