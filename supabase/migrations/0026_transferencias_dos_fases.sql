-- 0026_transferencias_dos_fases.sql — Transferencias en dos fases (envío + recepción).
--  Antes: movimiento instantáneo (origen − y destino + de una).
--  Ahora: al crear se ENVÍA (estado 'enviada', descuenta el origen; stock en tránsito).
--  En destino se controla por escaneo y se RECIBE (estado 'recibida', incrementa el
--  destino). Cancelar una enviada repone el stock del origen. Append-only e idempotente.

-- Estados nuevos + campos de recepción.
alter table public.stock_transfers drop constraint if exists stock_transfers_status_check;
update public.stock_transfers set status = 'recibida' where status in ('completada', 'pendiente');
alter table public.stock_transfers add constraint stock_transfers_status_check
  check (status in ('enviada', 'recibida', 'cancelada'));
alter table public.stock_transfers alter column status set default 'enviada';
alter table public.stock_transfers add column if not exists received_at timestamptz;
alter table public.stock_transfers add column if not exists received_by uuid references auth.users(id);
create index if not exists stock_transfers_status_idx on public.stock_transfers (organization_id, status, created_at desc);

-- ── create_transfer: sólo ENVÍO ──────────────────────────────
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
  values (v_org, p_from, p_to, 'enviada', nullif(trim(coalesce(p_notes,'')),''), auth.uid())
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

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, p_from, v_variant, -v_qty, 'transferencia', 'transfer', v_transfer, auth.uid());
  end loop;

  return v_transfer;
end; $$;

-- ── receive_transfer: RECEPCIÓN (incrementa el destino) ──────
create or replace function public.receive_transfer(p_transfer_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_to uuid; v_it record;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select to_warehouse_id into v_to from public.stock_transfers
    where id = p_transfer_id and organization_id = v_org and status = 'enviada';
  if not found then raise exception 'Transferencia no encontrada o ya recibida'; end if;

  for v_it in select variant_id, quantity from public.stock_transfer_items where transfer_id = p_transfer_id
  loop
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, v_to, v_it.variant_id, v_it.quantity)
    on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + v_it.quantity, updated_at = now();

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_to, v_it.variant_id, v_it.quantity, 'transferencia', 'transfer', p_transfer_id, auth.uid());
  end loop;

  update public.stock_transfers set status = 'recibida', received_at = now(), received_by = auth.uid()
    where id = p_transfer_id;
end; $$;

-- ── cancel_transfer: repone el stock del origen ──────────────
create or replace function public.cancel_transfer(p_transfer_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_from uuid; v_it record;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select from_warehouse_id into v_from from public.stock_transfers
    where id = p_transfer_id and organization_id = v_org and status = 'enviada';
  if not found then raise exception 'Transferencia no encontrada o ya recibida'; end if;

  for v_it in select variant_id, quantity from public.stock_transfer_items where transfer_id = p_transfer_id
  loop
    update public.stock set quantity = quantity + v_it.quantity, updated_at = now()
    where warehouse_id = v_from and variant_id = v_it.variant_id;

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_from, v_it.variant_id, v_it.quantity, 'transferencia_cancel', 'transfer', p_transfer_id, auth.uid());
  end loop;

  update public.stock_transfers set status = 'cancelada' where id = p_transfer_id;
end; $$;
