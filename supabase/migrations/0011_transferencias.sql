-- 0011_transferencias.sql — Transferencia de stock entre depósitos (atómica).
-- Usa stock_transfers / stock_transfer_items (creadas en 0002). Idempotente.

create or replace function public.create_transfer(
  p_from  uuid,
  p_to    uuid,
  p_items jsonb,   -- [{ variant_id, product_name, quantity }]
  p_notes text
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_transfer uuid; v_el jsonb; v_variant uuid; v_qty integer; v_have integer;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_from = p_to then raise exception 'El origen y el destino no pueden ser el mismo depósito'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La transferencia no tiene ítems'; end if;

  insert into public.stock_transfers (organization_id, from_warehouse_id, to_warehouse_id, status, notes, created_by)
  values (v_org, p_from, p_to, 'completada', nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  returning id into v_transfer;

  for v_el in select e from jsonb_array_elements(p_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;

    select quantity into v_have from public.stock where warehouse_id = p_from and variant_id = v_variant;
    if coalesce(v_have, 0) < v_qty then
      raise exception 'Stock insuficiente en el origen para % (hay %, se piden %)', v_el->>'product_name', coalesce(v_have,0), v_qty;
    end if;

    insert into public.stock_transfer_items (transfer_id, variant_id, quantity)
    values (v_transfer, v_variant, v_qty);

    update public.stock set quantity = quantity - v_qty, updated_at = now()
    where warehouse_id = p_from and variant_id = v_variant;

    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, p_to, v_variant, v_qty)
    on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + v_qty, updated_at = now();

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, p_from, v_variant, -v_qty, 'transferencia', 'transfer', v_transfer, auth.uid()),
           (v_org, p_to,   v_variant,  v_qty, 'transferencia', 'transfer', v_transfer, auth.uid());
  end loop;

  return v_transfer;
end; $$;
