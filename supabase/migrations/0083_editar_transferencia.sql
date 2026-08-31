-- 0083_editar_transferencia.sql — editar una transferencia aún NO enviada.
--
-- Permite cambiar ítems/cantidades de una transferencia en estado 'creada' (todavía
-- no se envió: no salió nada físico del origen, solo hay una reserva). Revierte y
-- re-aplica en una transacción:
--   • libera la reserva de los ítems viejos en el origen,
--   • valida disponible y reserva los ítems nuevos.
-- Es la misma semántica que la rama 'creada' de cancel_transfer + create_transfer.
--
-- Reglas: solo admin; solo status='creada'. Una vez 'enviada' no se edita (para
-- cambiarla hay que cancelar y rehacer). No toca el destino (nunca se tocó).
-- Cubre también las reposiciones: una reposición aceptada es una transferencia
-- 'creada' normal (origen = Mayorista - Central).
-- Append-only e idempotente.

create or replace function public.edit_transfer(p_transfer_id uuid, p_items jsonb)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_from uuid; v_status text;
  v_it record; v_el jsonb; v_variant uuid; v_qty integer; v_have numeric; v_res numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not public.is_admin() then raise exception 'Solo un administrador puede editar transferencias'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La transferencia no puede quedar sin ítems'; end if;

  select from_warehouse_id, status into v_from, v_status
  from public.stock_transfers where id = p_transfer_id and organization_id = v_org for update;
  if not found then raise exception 'Transferencia no encontrada'; end if;
  if v_status <> 'creada' then raise exception 'Solo se puede editar una transferencia creada (todavía sin enviar)'; end if;

  -- REVERT: liberar la reserva de los ítems actuales en el origen.
  for v_it in select variant_id, quantity from public.stock_transfer_items where transfer_id = p_transfer_id
  loop
    update public.stock set reserved = greatest(coalesce(reserved,0) - v_it.quantity, 0), updated_at = now()
      where warehouse_id = v_from and variant_id = v_it.variant_id;
  end loop;
  delete from public.stock_transfer_items where transfer_id = p_transfer_id;

  -- RE-APLICAR: reservar los ítems nuevos (valida disponible tras liberar la reserva vieja).
  for v_el in select e from jsonb_array_elements(p_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then continue; end if;

    select quantity, reserved into v_have, v_res from public.stock
      where warehouse_id = v_from and variant_id = v_variant for update;
    if coalesce(v_have,0) - coalesce(v_res,0) < v_qty then
      raise exception 'Sin stock disponible de "%" en el origen (disponible %, se piden %)',
        coalesce(nullif(v_el->>'product_name',''), 'producto'), coalesce(v_have,0) - coalesce(v_res,0), v_qty;
    end if;
    update public.stock set reserved = coalesce(reserved,0) + v_qty, updated_at = now()
      where warehouse_id = v_from and variant_id = v_variant;

    insert into public.stock_transfer_items (transfer_id, variant_id, quantity)
    values (p_transfer_id, v_variant, v_qty);
  end loop;
end $$;
