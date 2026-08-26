-- 0054_reposiciones.sql — Módulo Reposiciones.
--
-- Los mostradores venden y hay que reponer desde Mayorista-Central. Cada venta de
-- mostrador acumula lo vendido en un "pendiente de reposición" por local+variante.
-- El encargado abre el pendiente, elige qué reponer (tope = disponible de Central),
-- y al aceptar se crea una TRANSFERENCIA Central → mostrador (proceso normal de dos
-- fases) y se DESCARTA todo el resto del pendiente.
-- El pendiente lo mantiene un trigger sobre stock_movements (no se toca create_sale):
--   · venta de mostrador (reason 'venta', delta<0) → suma.
--   · devolución/anulación en mostrador (reason 'cambio'/'anulacion', delta>0) → resta.
-- Append-only e idempotente.

create table if not exists public.replenishment_pending (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  qty             integer not null default 0,
  updated_at      timestamptz not null default now(),
  unique (store_id, variant_id)
);
alter table public.replenishment_pending enable row level security;
drop policy if exists replenishment_pending_all on public.replenishment_pending;
create policy replenishment_pending_all on public.replenishment_pending for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());

-- ── Trigger: mantener el pendiente de reposición desde los movimientos de stock ─
create or replace function public.tg_replenishment() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_store uuid;
begin
  -- El depósito del movimiento debe pertenecer a un local de MOSTRADOR (no mayorista).
  select id into v_store from public.stores
    where warehouse_id = NEW.warehouse_id and coalesce(is_wholesale, false) = false
    limit 1;
  if v_store is null then return NEW; end if;

  if NEW.reason = 'venta' and NEW.delta < 0 then
    insert into public.replenishment_pending (organization_id, store_id, variant_id, qty)
    values (NEW.organization_id, v_store, NEW.variant_id, -NEW.delta)
    on conflict (store_id, variant_id) do update set qty = replenishment_pending.qty + (-NEW.delta), updated_at = now();
  elsif NEW.reason in ('cambio', 'anulacion') and NEW.delta > 0 then
    update public.replenishment_pending
      set qty = greatest(qty - NEW.delta, 0), updated_at = now()
      where store_id = v_store and variant_id = NEW.variant_id;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_replenishment on public.stock_movements;
create trigger trg_replenishment after insert on public.stock_movements
  for each row execute function public.tg_replenishment();

-- ── accept_replenishment: crea la transferencia y descarta el resto ────────────
create or replace function public.accept_replenishment(p_store_id uuid, p_items jsonb)
returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_store_wh uuid; v_central_wh uuid;
  v_el jsonb; v_variant uuid; v_qty integer; v_pending integer; v_avail integer; v_res integer;
  v_pname text; v_items jsonb := '[]'::jsonb; v_transfer uuid;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select warehouse_id into v_store_wh from public.stores
    where id = p_store_id and organization_id = v_org and coalesce(is_wholesale, false) = false;
  if v_store_wh is null then raise exception 'Local de mostrador inválido'; end if;

  select st.warehouse_id into v_central_wh
  from public.stores st join public.warehouses w on w.id = st.warehouse_id
  where st.organization_id = v_org and w.name = 'Mayorista - Central' limit 1;
  if v_central_wh is null then raise exception 'No hay depósito Mayorista-Central'; end if;

  for v_el in select e from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := coalesce((v_el->>'quantity')::integer, 0);
    if v_qty <= 0 then continue; end if;

    select qty into v_pending from public.replenishment_pending where store_id = p_store_id and variant_id = v_variant;
    if coalesce(v_pending, 0) < v_qty then raise exception 'No podés reponer más de lo pendiente de una prenda'; end if;

    select quantity, reserved into v_avail, v_res from public.stock where warehouse_id = v_central_wh and variant_id = v_variant;
    if coalesce(v_avail,0) - coalesce(v_res,0) < v_qty then
      raise exception 'Mayorista-Central no tiene disponible suficiente de una prenda';
    end if;

    select p.name into v_pname from public.product_variants pv join public.products p on p.id = pv.product_id where pv.id = v_variant;
    v_items := v_items || jsonb_build_object('variant_id', v_variant, 'product_name', coalesce(v_pname, ''), 'quantity', v_qty);
  end loop;

  -- Crea la transferencia Central → mostrador (proceso normal de dos fases).
  if jsonb_array_length(v_items) > 0 then
    v_transfer := public.create_transfer(v_central_wh, v_store_wh, v_items, 'Reposición de mostrador');
  end if;

  -- Descarta TODO el pendiente del local (lo elegido se transfirió; el resto se descarta).
  delete from public.replenishment_pending where store_id = p_store_id;

  return v_transfer;
end; $$;

-- Permiso 'reposiciones' para el SuperAdministrador (el dueño lo asigna a Logística/Depósito).
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, 'reposiciones', true, true
from public.roles r where r.name = 'SuperAdministrador'
on conflict (role_id, module) do update set can_view = true, can_edit = true;
