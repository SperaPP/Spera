-- 0050_fixes_auditoria.sql — Correcciones de la auditoría de producción.
--
-- 1) Índice cash_sessions_one_open (0007) rompía el multicajero (titular + apoyo):
--    impedía 2 cajas 'abierta' por local. Se elimina.
-- 2) adjust_stock / apply_stock_count fijaban el físico ignorando 'reserved' →
--    podía quedar reserved > quantity (disponible negativo, despacho trabado).
--    Ahora clampan reserved <= nuevo físico, y un CHECK garantiza el invariante.
-- 3) cancel_sale / dispatch_sale no bloqueaban la fila de sales → doble anulación
--    o doble despacho concurrente. Se agrega SELECT ... FOR UPDATE.
-- 4) cancel_sale sobre un pedido YA DESPACHADO reponía físico inexistente y borraba
--    la deuda ("regalar mercadería"). Se bloquea; para revertir un envío va devolución.
-- 5) Reportes inflaban "Vendido" por el crédito reusado (medios 'cambio' y
--    'saldo_favor'). Ahora netean ese crédito.
-- Append-only e idempotente.

-- ── 1) Multicajero: sacar el índice de "una sola caja abierta por local" ───────
drop index if exists public.cash_sessions_one_open;

-- ── 2) Ajuste/conteo de stock respetan lo reservado ───────────────────────────
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
  from public.stock where warehouse_id = p_warehouse_id and variant_id = p_variant_id for update;
  v_current := coalesce(v_current, 0);
  v_delta := p_new_quantity - v_current;

  if v_delta = 0 then return p_new_quantity; end if;

  -- El físico nuevo manda; si hay más reservado que físico, se libera el sobrante
  -- (no se puede reservar lo que no existe).
  insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
  values (v_org, p_warehouse_id, p_variant_id, p_new_quantity)
  on conflict (warehouse_id, variant_id) do update
    set quantity = p_new_quantity,
        reserved = least(public.stock.reserved, p_new_quantity),
        updated_at = now();

  insert into public.stock_movements
    (organization_id, warehouse_id, variant_id, delta, reason, reference_type, created_by)
  values (v_org, p_warehouse_id, p_variant_id, v_delta, coalesce(nullif(p_reason,''),'ajuste'), 'stock_adjust', auth.uid());

  return p_new_quantity;
end; $$;

create or replace function public.apply_stock_count(p_warehouse_id uuid, p_counts jsonb)
returns integer language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_el jsonb; v_variant uuid; v_new integer; v_old integer; v_delta integer; n integer := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and organization_id = v_org) then
    raise exception 'Depósito inválido';
  end if;
  if p_counts is null or jsonb_array_length(p_counts) = 0 then raise exception 'El conteo está vacío'; end if;

  for v_el in select e from jsonb_array_elements(p_counts) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_new := greatest(0, coalesce((v_el->>'quantity')::integer, 0));
    select quantity into v_old from public.stock where warehouse_id = p_warehouse_id and variant_id = v_variant for update;
    v_delta := v_new - coalesce(v_old, 0);
    if v_delta = 0 then continue; end if;

    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, p_warehouse_id, v_variant, v_new)
    on conflict (warehouse_id, variant_id) do update
      set quantity = v_new,
          reserved = least(public.stock.reserved, v_new),
          updated_at = now();

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, p_warehouse_id, v_variant, v_delta, 'conteo', 'stock_count', null, auth.uid());
    n := n + 1;
  end loop;

  return n;
end; $$;

-- Invariante duro: nunca reservar más de lo que hay físicamente.
do $$ begin
  alter table public.stock add constraint stock_reserved_le_quantity
    check (reserved >= 0 and reserved <= quantity);
exception when duplicate_object then null; end $$;

-- ── 3+4) cancel_sale: lock de fila + no anular pedidos ya despachados ──────────
create or replace function public.cancel_sale(p_sale_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_customer uuid; v_coupon uuid; v_channel text; v_fs text; v_it record; v_net numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select s.customer_id, s.coupon_id, s.channel, s.fulfillment_status, st.warehouse_id
    into v_customer, v_coupon, v_channel, v_fs, v_wh
  from public.sales s join public.stores st on st.id = s.store_id
  where s.id = p_sale_id and s.organization_id = v_org and s.status = 'completada'
  for update of s;
  if not found then raise exception 'Venta no encontrada o ya anulada'; end if;

  if v_channel = 'cambio' then
    raise exception 'Esta venta proviene de un cambio. Para deshacerlo hacé el cambio inverso; no se anula directamente.';
  end if;

  if v_fs = 'despachado' then
    raise exception 'Este pedido ya fue despachado. Para revertirlo hacé una devolución/ajuste; no se anula directamente.';
  end if;

  if exists (select 1 from public.sale_items where sale_id = p_sale_id and returned_qty > 0) then
    raise exception 'Esta venta tiene prendas ya devueltas o cambiadas. Revertí el cambio antes de anular.';
  end if;

  for v_it in select variant_id, quantity from public.sale_items where sale_id = p_sale_id
  loop
    if v_fs in ('pendiente', 'controlado') then
      update public.stock set reserved = greatest(coalesce(reserved,0) - v_it.quantity, 0), updated_at = now()
        where warehouse_id = v_wh and variant_id = v_it.variant_id;
    else
      -- entregado (mostrador/cambio en el acto): el físico salió, se repone.
      insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
      values (v_org, v_wh, v_it.variant_id, v_it.quantity)
      on conflict (warehouse_id, variant_id) do update set quantity = public.stock.quantity + v_it.quantity, updated_at = now();
      insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_wh, v_it.variant_id, v_it.quantity, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
    end if;
  end loop;

  if v_customer is not null then
    select coalesce(sum(delta), 0) into v_net
      from public.customer_movements where reference_type = 'sale' and reference_id = p_sale_id and customer_id = v_customer;
    if v_net <> 0 then
      update public.customers set balance = balance - v_net where id = v_customer;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_customer, -v_net, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
    end if;
  end if;

  if v_coupon is not null then
    update public.coupons set used_count = greatest(used_count - 1, 0) where id = v_coupon;
  end if;

  update public.sales set status = 'anulada' where id = p_sale_id;
end; $$;

-- ── 3) dispatch_sale: lock de fila para evitar doble despacho ──────────────────
create or replace function public.dispatch_sale(
  p_sale_id uuid, p_shipping_method_id uuid, p_tracking text, p_notes text
) returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_it record; v_have numeric; v_total numeric; v_paid numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_shipping_method_id is null then raise exception 'Elegí el método de despacho'; end if;

  select st.warehouse_id, s.total, s.paid_amount into v_wh, v_total, v_paid
  from public.sales s join public.stores st on st.id = s.store_id
  where s.id = p_sale_id and s.organization_id = v_org
    and s.status = 'completada' and s.fulfillment_status = 'controlado'
  for update of s;
  if v_wh is null then raise exception 'El pedido no está listo para despachar'; end if;

  if coalesce(v_paid,0) < v_total - 0.01 then
    raise exception 'El pedido no está pago. Cobralo antes de despachar (falta %).', to_char(v_total - coalesce(v_paid,0), 'FM999999990.00');
  end if;

  for v_it in select variant_id, quantity from public.sale_items where sale_id = p_sale_id
  loop
    select quantity into v_have from public.stock where warehouse_id = v_wh and variant_id = v_it.variant_id for update;
    if coalesce(v_have,0) < v_it.quantity then
      raise exception 'No hay stock físico para despachar una de las prendas';
    end if;
    update public.stock set quantity = v_have - v_it.quantity,
                            reserved = greatest(coalesce(reserved,0) - v_it.quantity, 0),
                            updated_at = now()
      where warehouse_id = v_wh and variant_id = v_it.variant_id;
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_wh, v_it.variant_id, -v_it.quantity, 'despacho', 'sale', p_sale_id, auth.uid());
  end loop;

  update public.sales set
    fulfillment_status = 'despachado',
    shipping_method_id = p_shipping_method_id,
    tracking = nullif(trim(coalesce(p_tracking,'')), ''),
    dispatch_notes = nullif(trim(coalesce(p_notes,'')), ''),
    dispatched_at = now(),
    dispatched_by = auth.uid()
  where id = p_sale_id;
end; $$;

-- ── 5) Reportes: netear el crédito reusado (cambio + saldo a favor) ────────────
create or replace function public.report_summary(p_from timestamptz, p_to timestamptz, p_store_id uuid default null)
returns jsonb language plpgsql stable as $$
declare v_ventas numeric; v_cant bigint; v_unid bigint; v_credito numeric;
begin
  select coalesce(sum(total), 0), count(*) into v_ventas, v_cant
  from public.sales
  where organization_id = public.current_org_id() and status = 'completada'
    and created_at >= p_from and created_at < p_to
    and (p_store_id is null or store_id = p_store_id);

  -- Crédito reusado (no es venta nueva): pagos con medios 'cambio' o 'saldo_favor'.
  select coalesce(sum(sp.amount), 0) into v_credito
  from public.sale_payments sp
  join public.sales s on s.id = sp.sale_id
  join public.payment_methods pm on pm.id = sp.payment_method_id
  where s.organization_id = public.current_org_id() and s.status = 'completada'
    and s.created_at >= p_from and s.created_at < p_to
    and (p_store_id is null or s.store_id = p_store_id)
    and pm.kind in ('cambio', 'saldo_favor');

  select coalesce(sum(si.quantity), 0) into v_unid
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.organization_id = public.current_org_id() and s.status = 'completada'
    and s.created_at >= p_from and s.created_at < p_to
    and (p_store_id is null or s.store_id = p_store_id);

  return jsonb_build_object('ventas', v_ventas - v_credito, 'cantidad', v_cant, 'unidades', v_unid);
end; $$;

create or replace function public.report_by_store(p_from timestamptz, p_to timestamptz, p_store_id uuid default null)
returns table(store text, ventas numeric, cantidad bigint) language sql stable as $$
  select st.name,
         (coalesce(sum(s.total), 0) - coalesce(sum(cr.credito), 0))::numeric,
         count(*)::bigint
  from public.sales s
  join public.stores st on st.id = s.store_id
  left join lateral (
    select coalesce(sum(sp.amount), 0) as credito
    from public.sale_payments sp
    join public.payment_methods pm on pm.id = sp.payment_method_id
    where sp.sale_id = s.id and pm.kind in ('cambio', 'saldo_favor')
  ) cr on true
  where s.organization_id = public.current_org_id() and s.status = 'completada'
    and s.created_at >= p_from and s.created_at < p_to
    and (p_store_id is null or s.store_id = p_store_id)
  group by st.name order by 2 desc;
$$;
