-- 0076_transferencia_reserva.sql — la transferencia RESERVA el stock al crearse.
--
-- Bug: una transferencia en 'creada' no comprometía el stock (el físico salía recién
-- al enviar), así que otra persona podía tomar la MISMA prenda en otra transferencia
-- o en una venta → doble compromiso. Además el chequeo no tenía FOR UPDATE (carrera).
-- Ahora:
--  · create_transfer: reserva (reserved += qty) con FOR UPDATE → el disponible baja,
--    nadie más la puede tomar. No mueve el físico (el planificador no tiene la prenda).
--  · send_transfer: descuenta el físico y libera la reserva que tomó al crearse.
--  · cancel_transfer: 'creada' libera la reserva; 'enviada' repone el físico (ya salió).
-- Append-only e idempotente.

create or replace function public.create_transfer(p_from uuid, p_to uuid, p_items jsonb, p_notes text)
returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_transfer uuid; v_el jsonb; v_variant uuid; v_qty integer; v_have integer; v_res integer;
begin
  if not public.has_perm('transferencias', true) then raise exception 'No tenés permiso para crear transferencias'; end if;
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_from = p_to then raise exception 'El origen y el destino no pueden ser el mismo depósito'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La transferencia no tiene ítems'; end if;

  insert into public.stock_transfers (organization_id, from_warehouse_id, to_warehouse_id, status, notes, created_by)
  values (v_org, p_from, p_to, 'creada', nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  returning id into v_transfer;

  for v_el in select e from jsonb_array_elements(p_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;

    -- RESERVA al crear: compromete el disponible (FOR UPDATE serializa contra otra
    -- creación o venta concurrente de la misma variante). El físico no se mueve.
    select quantity, reserved into v_have, v_res from public.stock
      where warehouse_id = p_from and variant_id = v_variant for update;
    if coalesce(v_have,0) - coalesce(v_res,0) < v_qty then
      raise exception 'Stock disponible insuficiente en el origen para % (disponible %, se piden %)',
        v_el->>'product_name', coalesce(v_have,0) - coalesce(v_res,0), v_qty;
    end if;
    update public.stock set reserved = coalesce(reserved,0) + v_qty, updated_at = now()
      where warehouse_id = p_from and variant_id = v_variant;

    insert into public.stock_transfer_items (transfer_id, variant_id, quantity)
    values (v_transfer, v_variant, v_qty);
  end loop;

  return v_transfer;
end; $$;

create or replace function public.send_transfer(p_transfer_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_from uuid; v_it record; v_have integer;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select from_warehouse_id into v_from from public.stock_transfers
    where id = p_transfer_id and organization_id = v_org and status = 'creada' for update;
  if not found then raise exception 'Transferencia no encontrada o ya enviada'; end if;

  for v_it in select variant_id, quantity from public.stock_transfer_items where transfer_id = p_transfer_id
  loop
    select quantity into v_have from public.stock where warehouse_id = v_from and variant_id = v_it.variant_id for update;
    if coalesce(v_have,0) < v_it.quantity then
      raise exception 'No hay stock físico para enviar una de las prendas';
    end if;
    -- Sale el físico y se libera la reserva que tomó al crearse.
    update public.stock set quantity = quantity - v_it.quantity,
                            reserved = greatest(coalesce(reserved,0) - v_it.quantity, 0),
                            updated_at = now()
      where warehouse_id = v_from and variant_id = v_it.variant_id;
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_from, v_it.variant_id, -v_it.quantity, 'transferencia', 'transfer', p_transfer_id, auth.uid());
  end loop;

  update public.stock_transfers set status = 'enviada', sent_at = now(), sent_by = auth.uid()
    where id = p_transfer_id;
end; $$;

create or replace function public.cancel_transfer(p_transfer_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_from uuid; v_status text; v_it record;
begin
  if not public.has_perm('transferencias', true) then raise exception 'No tenés permiso para cancelar transferencias'; end if;
  if v_org is null then raise exception 'Sin organización'; end if;
  select from_warehouse_id, status into v_from, v_status from public.stock_transfers
    where id = p_transfer_id and organization_id = v_org and status in ('creada', 'enviada') for update;
  if not found then raise exception 'Transferencia no encontrada o ya recibida/cancelada'; end if;

  for v_it in select variant_id, quantity from public.stock_transfer_items where transfer_id = p_transfer_id
  loop
    if v_status = 'creada' then
      -- Libera la reserva que tomó al crearse (el físico nunca salió).
      update public.stock set reserved = greatest(coalesce(reserved,0) - v_it.quantity, 0), updated_at = now()
        where warehouse_id = v_from and variant_id = v_it.variant_id;
    else -- 'enviada': el físico ya salió → reponer.
      update public.stock set quantity = quantity + v_it.quantity, updated_at = now()
        where warehouse_id = v_from and variant_id = v_it.variant_id;
      insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_from, v_it.variant_id, v_it.quantity, 'transferencia_cancel', 'transfer', p_transfer_id, auth.uid());
    end if;
  end loop;

  update public.stock_transfers set status = 'cancelada' where id = p_transfer_id;
end; $$;
