-- 0086_multi_cupon.sql — permite aplicar VARIOS cupones en una venta.
--
-- create_sale gana un parámetro p_coupon_ids (jsonb array). Es RETROCOMPATIBLE:
-- tiene default null y, si no viene, usa p_coupon_id (una venta con la firma vieja
-- sigue funcionando sin tocar nada). Cada cupón descuenta su parte del subtotal;
-- se suman y se topean al subtotal. Se registran todos en sale_coupons y se
-- incrementa el used_count de cada uno. cancel_sale revierte todos.
-- Append-only e idempotente.

-- ── Tabla de cupones por venta (varios por venta) ────────────
create table if not exists public.sale_coupons (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references public.sales(id) on delete cascade,
  coupon_id  uuid not null references public.coupons(id),
  created_at timestamptz not null default now()
);
create unique index if not exists sale_coupons_uq on public.sale_coupons (sale_id, coupon_id);

alter table public.sale_coupons enable row level security;
drop policy if exists sale_coupons_all on public.sale_coupons;
create policy sale_coupons_all on public.sale_coupons for all
  using (exists (select 1 from public.sales s where s.id = sale_id and s.organization_id = public.current_org_id()))
  with check (exists (select 1 from public.sales s where s.id = sale_id and s.organization_id = public.current_org_id()));

-- ── create_sale con varios cupones ───────────────────────────
create or replace function public.create_sale(
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_customer_id     uuid,
  p_price_list_id   uuid,
  p_coupon_id       uuid,
  p_customer_data   jsonb,
  p_items           jsonb,
  p_payments        jsonb,
  p_coupon_ids      jsonb default null
) returns uuid language plpgsql as $$
declare
  v_org      uuid := public.current_org_id();
  v_wh       uuid;
  v_wholesale boolean;
  v_sale     uuid;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total    numeric := 0;
  v_el       jsonb;
  v_qty      integer;
  v_variant  uuid;
  v_have     numeric;
  v_res      numeric;
  c          record;
  v_cc       numeric := 0;
  v_credit   numeric := 0;
  v_real     numeric := 0;
  v_kind     text;
  v_amt      numeric;
  v_balance  numeric;
  v_due_acct numeric;
  v_excess   numeric;
  v_coupon_ids jsonb;
  v_cid      uuid;
  v_txt      text;
  v_first_coupon uuid;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select warehouse_id, coalesce(is_wholesale,false) into v_wh, v_wholesale
    from public.stores where id = p_store_id and organization_id = v_org;
  if v_wh is null then raise exception 'Local inválido'; end if;

  select coalesce(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) e;

  -- Cupones: usa p_coupon_ids si viene; si no, cae a p_coupon_id (retrocompat).
  v_coupon_ids := coalesce(p_coupon_ids,
    case when p_coupon_id is not null then jsonb_build_array(p_coupon_id) else '[]'::jsonb end);

  for v_txt in select value from jsonb_array_elements_text(v_coupon_ids) loop
    v_cid := v_txt::uuid;
    select * into c from public.coupons where id = v_cid and organization_id = v_org for update;
    if not found then raise exception 'Cupón inexistente'; end if;
    if not c.active then raise exception 'El cupón % está inactivo', c.code; end if;
    if c.expires_at is not null and c.expires_at < current_date then raise exception 'El cupón % está vencido', c.code; end if;
    if c.max_uses is not null and c.used_count >= c.max_uses then raise exception 'El cupón % alcanzó su límite de usos', c.code; end if;
    if c.min_amount is not null and v_subtotal < c.min_amount then raise exception 'La compra no alcanza el mínimo del cupón %', c.code; end if;
    if c.discount_type = 'percent' then v_discount := v_discount + round(v_subtotal * c.discount_value / 100);
    else v_discount := v_discount + c.discount_value; end if;
    update public.coupons set used_count = used_count + 1 where id = v_cid;
    if v_first_coupon is null then v_first_coupon := v_cid; end if;
  end loop;
  if v_discount > v_subtotal then v_discount := v_subtotal; end if;

  v_total := v_subtotal - v_discount;

  for v_el in select e from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) as e
  loop
    v_amt := (v_el->>'amount')::numeric;
    select kind into v_kind from public.payment_methods where id = (v_el->>'payment_method_id')::uuid;
    if v_kind = 'cuenta_corriente' then v_cc := v_cc + v_amt;
    elsif v_kind = 'saldo_favor' then v_credit := v_credit + v_amt;
    else v_real := v_real + v_amt;
    end if;
  end loop;

  if (v_cc > 0 or v_credit > 0) and p_customer_id is null then
    raise exception 'Fiar o usar saldo a favor requiere un cliente identificado';
  end if;

  if v_credit > 0 then
    select balance into v_balance from public.customers where id = p_customer_id and organization_id = v_org for update;
    if v_credit > greatest(0, -coalesce(v_balance,0)) then
      raise exception 'El saldo a favor disponible no alcanza';
    end if;
  end if;

  v_due_acct := v_total - v_cc - v_credit;
  if v_due_acct < 0 then raise exception 'Los pagos a cuenta superan el total'; end if;
  if v_real < v_due_acct then raise exception 'Pago insuficiente'; end if;
  v_excess := v_real - v_due_acct;
  if v_excess > 0 and p_customer_id is null then
    raise exception 'El excedente requiere un cliente (en mostrador se cobra exacto)';
  end if;

  insert into public.sales (organization_id, store_id, cash_session_id, customer_id, price_list_id,
                            coupon_id, subtotal, discount, total, paid_amount,
                            customer_name, customer_doc, customer_phone, customer_email, created_by)
  values (v_org, p_store_id, p_cash_session_id, p_customer_id, p_price_list_id,
          v_first_coupon, v_subtotal, v_discount, v_total, greatest(0, v_total - v_cc),
          nullif(trim(coalesce(p_customer_data->>'name','')),''),
          nullif(trim(coalesce(p_customer_data->>'doc','')),''),
          nullif(trim(coalesce(p_customer_data->>'phone','')),''),
          nullif(trim(coalesce(p_customer_data->>'email','')),''),
          auth.uid())
  returning id into v_sale;

  for v_txt in select value from jsonb_array_elements_text(v_coupon_ids) loop
    insert into public.sale_coupons (sale_id, coupon_id) values (v_sale, v_txt::uuid) on conflict do nothing;
  end loop;

  for v_el in select e from jsonb_array_elements(p_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;
    insert into public.sale_items (sale_id, variant_id, product_name, variant_label, quantity, unit_price, line_total)
    values (v_sale, v_variant, v_el->>'product_name', nullif(v_el->>'variant_label',''),
            v_qty, (v_el->>'unit_price')::numeric, v_qty * (v_el->>'unit_price')::numeric);

    select quantity, reserved into v_have, v_res from public.stock
      where warehouse_id = v_wh and variant_id = v_variant for update;
    if coalesce(v_have,0) - coalesce(v_res,0) < v_qty then
      raise exception 'Sin stock disponible de "%" (disponible %, se piden %)',
        coalesce(nullif(v_el->>'product_name',''), 'producto') || coalesce(' ' || nullif(v_el->>'variant_label',''), ''),
        coalesce(v_have,0) - coalesce(v_res,0), v_qty;
    end if;

    if v_wholesale then
      update public.stock set reserved = coalesce(reserved,0) + v_qty, updated_at = now()
        where warehouse_id = v_wh and variant_id = v_variant;
    else
      update public.stock set quantity = v_have - v_qty, updated_at = now()
        where warehouse_id = v_wh and variant_id = v_variant;
      insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_wh, v_variant, -v_qty, 'venta', 'sale', v_sale, auth.uid());
    end if;
  end loop;

  for v_el in select e from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) as e
  loop
    insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
    values (v_sale, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric,
            coalesce((v_el->>'surcharge')::numeric, 0));
  end loop;

  if p_customer_id is not null then
    if v_cc > 0 then
      update public.customers set balance = balance + v_cc where id = p_customer_id;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, v_cc, 'venta', 'sale', v_sale, auth.uid());
    end if;
    if v_credit > 0 then
      update public.customers set balance = balance + v_credit where id = p_customer_id;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, v_credit, 'saldo_favor', 'sale', v_sale, auth.uid());
    end if;
    if v_excess > 0 then
      update public.customers set balance = balance - v_excess where id = p_customer_id;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, -v_excess, 'sobrepago', 'sale', v_sale, auth.uid());
    end if;
  end if;

  return v_sale;
end; $$;

-- ── cancel_sale: revierte el used_count de TODOS los cupones ───
create or replace function public.cancel_sale(p_sale_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_customer uuid; v_coupon uuid; v_channel text; v_fs text; v_it record; v_net numeric;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  if not public.is_admin() then raise exception 'Solo un administrador puede anular ventas'; end if;

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

  -- Devuelve el uso de TODOS los cupones de la venta (o el legacy coupon_id).
  if exists (select 1 from public.sale_coupons where sale_id = p_sale_id) then
    update public.coupons set used_count = greatest(used_count - 1, 0)
      where id in (select coupon_id from public.sale_coupons where sale_id = p_sale_id);
  elsif v_coupon is not null then
    update public.coupons set used_count = greatest(used_count - 1, 0) where id = v_coupon;
  end if;

  update public.sales set status = 'anulada' where id = p_sale_id;
end; $$;
