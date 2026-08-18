-- 0024_baja_devoluciones.sql — Baja del módulo Devoluciones (reemplazado por Cambios).
--  No había devoluciones cargadas (returns/return_items vacías), así que se elimina.
--  delete_variant deja de chequear return_items. Append-only e idempotente.

-- delete_variant sin la referencia a return_items (la tabla se elimina abajo).
create or replace function public.delete_variant(p_variant_id uuid) returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not exists (select 1 from public.product_variants where id = p_variant_id and organization_id = v_org) then
    raise exception 'Variante inválida';
  end if;
  if exists (select 1 from public.sale_items where variant_id = p_variant_id)
     or exists (select 1 from public.stock_transfer_items where variant_id = p_variant_id) then
    raise exception 'La variante tiene movimientos (ventas/transferencias): desactivala en lugar de borrarla';
  end if;

  delete from public.stock_movements where variant_id = p_variant_id;
  delete from public.stock where variant_id = p_variant_id;
  delete from public.price_list_items where variant_id = p_variant_id;
  delete from public.product_variants where id = p_variant_id;
end; $$;

-- RPCs del módulo (ya nadie los llama).
drop function if exists public.create_return(uuid, uuid, jsonb, text);
drop function if exists public.approve_return(uuid);
drop function if exists public.reject_return(uuid);
drop function if exists public.check_return_eligibility(uuid, uuid);

-- Tablas y secuencia.
drop table if exists public.return_items cascade;
drop table if exists public.returns cascade;
drop sequence if exists public.return_number_seq;

-- Permisos huérfanos del módulo.
delete from public.role_permissions where module = 'devoluciones';
