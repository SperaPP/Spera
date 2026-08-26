-- 0056_transferencia_creada.sql — Etapa "Creada" antes de "Enviada".
--
-- Antes: create_transfer nacía en 'enviada' y descontaba el origen al crear.
-- Ahora: create_transfer nace en 'creada' (nada se mueve); el depósito de origen
-- la controla/arma y con send_transfer pasa a 'enviada' (ahí sale el stock del
-- origen); el destino recibe (receive_transfer) → 'recibida'.
-- Flujo: creada → enviada → recibida.  cancel_transfer maneja creada y enviada.
-- Append-only e idempotente.

alter table public.stock_transfers add column if not exists sent_at timestamptz;
alter table public.stock_transfers add column if not exists sent_by uuid references auth.users(id);

-- ── create_transfer: nace 'creada', sin mover stock (chequea factibilidad) ─────
create or replace function public.create_transfer(
  p_from  uuid,
  p_to    uuid,
  p_items jsonb,
  p_notes text
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_transfer uuid; v_el jsonb; v_variant uuid; v_qty integer; v_have integer; v_res integer;
begin
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

    -- Factibilidad al crear (no descuenta; el stock sale recién al enviar).
    select quantity, reserved into v_have, v_res from public.stock where warehouse_id = p_from and variant_id = v_variant;
    if coalesce(v_have,0) - coalesce(v_res,0) < v_qty then
      raise exception 'Stock disponible insuficiente en el origen para % (disponible %, se piden %)',
        v_el->>'product_name', coalesce(v_have,0) - coalesce(v_res,0), v_qty;
    end if;

    insert into public.stock_transfer_items (transfer_id, variant_id, quantity)
    values (v_transfer, v_variant, v_qty);
  end loop;

  return v_transfer;
end; $$;

-- ── send_transfer: el origen la controla/arma → 'enviada' (ahí sale el stock) ──
create or replace function public.send_transfer(p_transfer_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_from uuid; v_it record; v_have integer; v_res integer;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select from_warehouse_id into v_from from public.stock_transfers
    where id = p_transfer_id and organization_id = v_org and status = 'creada' for update;
  if not found then raise exception 'Transferencia no encontrada o ya enviada'; end if;

  for v_it in select variant_id, quantity from public.stock_transfer_items where transfer_id = p_transfer_id
  loop
    select quantity, reserved into v_have, v_res from public.stock where warehouse_id = v_from and variant_id = v_it.variant_id for update;
    if coalesce(v_have,0) - coalesce(v_res,0) < v_it.quantity then
      raise exception 'Stock disponible insuficiente en el origen para una de las prendas';
    end if;
    update public.stock set quantity = quantity - v_it.quantity, updated_at = now()
      where warehouse_id = v_from and variant_id = v_it.variant_id;
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_from, v_it.variant_id, -v_it.quantity, 'transferencia', 'transfer', p_transfer_id, auth.uid());
  end loop;

  update public.stock_transfers set status = 'enviada', sent_at = now(), sent_by = auth.uid()
    where id = p_transfer_id;
end; $$;

-- ── cancel_transfer: maneja 'creada' (nada que reponer) y 'enviada' (repone) ───
create or replace function public.cancel_transfer(p_transfer_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_from uuid; v_status text; v_it record;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select from_warehouse_id, status into v_from, v_status from public.stock_transfers
    where id = p_transfer_id and organization_id = v_org and status in ('creada', 'enviada') for update;
  if not found then raise exception 'Transferencia no encontrada o ya recibida/cancelada'; end if;

  -- Solo si ya estaba enviada hay stock que reponer en el origen.
  if v_status = 'enviada' then
    for v_it in select variant_id, quantity from public.stock_transfer_items where transfer_id = p_transfer_id
    loop
      update public.stock set quantity = quantity + v_it.quantity, updated_at = now()
      where warehouse_id = v_from and variant_id = v_it.variant_id;
      insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_from, v_it.variant_id, v_it.quantity, 'transferencia_cancel', 'transfer', p_transfer_id, auth.uid());
    end loop;
  end if;

  update public.stock_transfers set status = 'cancelada' where id = p_transfer_id;
end; $$;
