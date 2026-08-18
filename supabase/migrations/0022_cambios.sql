-- 0022_cambios.sql — Cambio de mostrador (consumidor final).
--  Devolvés ítem(s) de una venta (por N°), se genera un crédito al precio pagado y
--  se usa TODO en la misma operación para llevar otra prenda. Sin efectivo, sin vale.
--  Se puede hacer en cualquier sucursal. Regla 30 días. Devolución por ítem/cantidad
--  con control de doble devolución. Si lo nuevo es más barato, el resto se pierde.
-- Append-only e idempotente.

-- Control de doble devolución por línea de venta.
alter table public.sale_items add column if not exists returned_qty integer not null default 0;

-- Medio de pago interno "Cambio" (crédito de la devolución aplicado a la venta nueva).
alter table public.payment_methods drop constraint if exists payment_methods_kind_check;
alter table public.payment_methods add constraint payment_methods_kind_check
  check (kind in ('efectivo','tarjeta','transferencia','digital','cuenta_corriente','saldo_favor','cambio','otro'));

insert into public.payment_methods (organization_id, name, kind, affects_cash, position)
select o.id, 'Cambio', 'cambio', false, 8 from public.organizations o
where o.name = 'Bodysculpt'
on conflict (organization_id, name) do nothing;

-- Registro de cambios (auditoría + para netear en reportes).
create table if not exists public.exchanges (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  store_id          uuid not null references public.stores(id),
  original_sale_id  uuid not null references public.sales(id),
  new_sale_id       uuid not null references public.sales(id),
  credit            numeric(14,2) not null,   -- valor devuelto (precio pagado)
  difference        numeric(14,2) not null,   -- lo que pagó de más (nuevo > crédito)
  forfeited         numeric(14,2) not null,   -- crédito perdido (nuevo < crédito)
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);
alter table public.exchanges enable row level security;
drop policy if exists exchanges_all on public.exchanges;
create policy exchanges_all on public.exchanges for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

-- ── RPC atómico ──────────────────────────────────────────────
create or replace function public.create_exchange(
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_original_sale   uuid,
  p_returned        jsonb,   -- [{ sale_item_id, quantity }]
  p_new_items       jsonb,   -- [{ variant_id, product_name, variant_label, quantity, unit_price }]
  p_diff_payments   jsonb    -- [{ payment_method_id, amount }]
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_created timestamptz;
  v_credit numeric := 0; v_new_total numeric := 0; v_diff numeric; v_diff_paid numeric := 0; v_applied numeric;
  v_cambio uuid; v_new_sale uuid;
  v_el jsonb; v_si record; v_qty integer; v_variant uuid;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select warehouse_id into v_wh from public.stores where id = p_store_id and organization_id = v_org;
  if v_wh is null then raise exception 'Local inválido'; end if;

  -- Venta original + regla 30 días.
  select created_at into v_created from public.sales
    where id = p_original_sale and organization_id = v_org and status = 'completada';
  if not found then raise exception 'Venta original no encontrada o anulada'; end if;
  if v_created < now() - interval '30 days' then raise exception 'La venta supera los 30 días de cambio'; end if;

  -- Devoluciones → crédito + reingreso de stock al local del cambio.
  if p_returned is null or jsonb_array_length(p_returned) = 0 then raise exception 'No seleccionaste qué devolver'; end if;
  for v_el in select e from jsonb_array_elements(p_returned) as e
  loop
    v_qty := (v_el->>'quantity')::integer;
    select * into v_si from public.sale_items where id = (v_el->>'sale_item_id')::uuid and sale_id = p_original_sale;
    if not found then raise exception 'Un ítem no pertenece a la venta'; end if;
    if v_qty <= 0 or v_qty > (v_si.quantity - v_si.returned_qty) then raise exception 'Cantidad a devolver inválida'; end if;

    v_credit := v_credit + v_qty * v_si.unit_price;
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
      values (v_org, v_wh, v_si.variant_id, v_qty)
      on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + v_qty, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_wh, v_si.variant_id, v_qty, 'cambio', 'exchange', p_original_sale, auth.uid());
    update public.sale_items set returned_qty = returned_qty + v_qty where id = v_si.id;
  end loop;

  -- Prendas nuevas.
  if p_new_items is null or jsonb_array_length(p_new_items) = 0 then raise exception 'Elegí la prenda nueva del cambio'; end if;
  select coalesce(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    into v_new_total from jsonb_array_elements(p_new_items) e;

  -- Diferencia (exacta si lo nuevo es más caro).
  v_diff := v_new_total - v_credit;
  select coalesce(sum((e->>'amount')::numeric), 0) into v_diff_paid from jsonb_array_elements(coalesce(p_diff_payments,'[]'::jsonb)) e;
  if v_diff > 0 then
    if v_diff_paid < v_diff then raise exception 'Falta cobrar la diferencia'; end if;
    if v_diff_paid > v_diff then raise exception 'La diferencia cobrada es mayor a la que corresponde'; end if;
  elsif v_diff_paid > 0 then
    raise exception 'No hay diferencia a cobrar en este cambio';
  end if;
  v_applied := least(v_credit, v_new_total);   -- crédito realmente usado (el resto se pierde)

  -- Venta nueva (canal cambio).
  select id into v_cambio from public.payment_methods where organization_id = v_org and kind = 'cambio' limit 1;
  insert into public.sales (organization_id, store_id, cash_session_id, price_list_id, channel, subtotal, discount, total, created_by)
    values (v_org, p_store_id, p_cash_session_id, null, 'cambio', v_new_total, 0, v_new_total, auth.uid())
    returning id into v_new_sale;

  for v_el in select e from jsonb_array_elements(p_new_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;
    insert into public.sale_items (sale_id, variant_id, product_name, variant_label, quantity, unit_price, line_total)
      values (v_new_sale, v_variant, v_el->>'product_name', nullif(v_el->>'variant_label',''), v_qty, (v_el->>'unit_price')::numeric, v_qty * (v_el->>'unit_price')::numeric);
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
      values (v_org, v_wh, v_variant, -v_qty)
      on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity - v_qty, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_wh, v_variant, -v_qty, 'venta', 'sale', v_new_sale, auth.uid());
  end loop;

  -- Pagos: crédito aplicado (Cambio, no toca caja) + diferencia real.
  if v_applied > 0 and v_cambio is not null then
    insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
      values (v_new_sale, v_cambio, v_applied, 0);
  end if;
  for v_el in select e from jsonb_array_elements(coalesce(p_diff_payments,'[]'::jsonb)) as e
  loop
    insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
      values (v_new_sale, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric, 0);
  end loop;

  insert into public.exchanges (organization_id, store_id, original_sale_id, new_sale_id, credit, difference, forfeited, created_by)
    values (v_org, p_store_id, p_original_sale, v_new_sale, v_credit, greatest(v_diff, 0), greatest(v_credit - v_new_total, 0), auth.uid());

  return v_new_sale;
end; $$;
