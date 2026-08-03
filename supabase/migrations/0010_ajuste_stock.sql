-- 0010_ajuste_stock.sql — Ajuste/ingreso de stock: setea la existencia de una
-- variante en un depósito y registra el movimiento. Append-only e idempotente.

create or replace function public.adjust_stock(
  p_warehouse_id uuid,
  p_variant_id   uuid,
  p_new_quantity integer,
  p_reason       text
) returns integer language plpgsql as $$
declare
  v_org     uuid := public.current_org_id();
  v_current integer;
  v_delta   integer;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_new_quantity < 0 then raise exception 'La cantidad no puede ser negativa'; end if;

  select quantity into v_current
  from public.stock where warehouse_id = p_warehouse_id and variant_id = p_variant_id;
  v_current := coalesce(v_current, 0);
  v_delta := p_new_quantity - v_current;

  if v_delta = 0 then return p_new_quantity; end if;

  insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
  values (v_org, p_warehouse_id, p_variant_id, p_new_quantity)
  on conflict (warehouse_id, variant_id) do update set quantity = p_new_quantity, updated_at = now();

  insert into public.stock_movements
    (organization_id, warehouse_id, variant_id, delta, reason, reference_type, created_by)
  values (v_org, p_warehouse_id, p_variant_id, v_delta, coalesce(nullif(p_reason,''),'ajuste'), 'stock_adjust', auth.uid());

  return p_new_quantity;
end; $$;
