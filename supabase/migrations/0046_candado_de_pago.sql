-- 0046_candado_de_pago.sql — Tanda 2: no despachar sin pago + cobranza por pedido.
--
-- · sales.paid_amount: cuánto del total del pedido está cubierto. En create_sale se
--   fija = total − fiado (el fiado es lo pendiente); mostrador/pagado quedan en total.
--   Los pedidos EXISTENTES se marcan pagos (backfill = total) para no trabar lo viejo.
-- · receipt_allocations: imputación de cada cobranza a pedidos puntuales.
-- · create_receipt recibe p_allocations y sube el paid_amount de cada pedido, sin
--   imputar más de lo que debe el pedido ni más de lo que se cobra.
-- · dispatch_sale se traba si el pedido no está pago (paid_amount < total).
-- Append-only e idempotente.

alter table public.sales add column if not exists paid_amount numeric not null default 0;
-- Backfill: todo lo ya cargado se considera pago (no trabar pedidos previos al candado).
update public.sales set paid_amount = total where paid_amount = 0 and total > 0;

create table if not exists public.receipt_allocations (
  id         uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  sale_id    uuid not null references public.sales(id),
  amount     numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists receipt_allocations_sale_idx on public.receipt_allocations(sale_id);
create index if not exists receipt_allocations_receipt_idx on public.receipt_allocations(receipt_id);

-- ── create_sale: fija paid_amount = total − fiado ──────────────────────────────
create or replace function public.create_sale(
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_customer_id     uuid,
  p_price_list_id   uuid,
  p_coupon_id       uuid,
  p_customer_data   jsonb,
  p_items           jsonb,
  p_payments        jsonb
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
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select warehouse_id, coalesce(is_wholesale,false) into v_wh, v_wholesale
    from public.stores where id = p_store_id and organization_id = v_org;
  if v_wh is null then raise exception 'Local inválido'; end if;

  select coalesce(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) e;

  if p_coupon_id is not null then
    select * into c from public.coupons where id = p_coupon_id and organization_id = v_org for update;
    if not found then raise exception 'Cupón inexistente'; end if;
    if not c.active then raise exception 'El cupón está inactivo'; end if;
    if c.expires_at is not null and c.expires_at < current_date then raise exception 'El cupón está vencido'; end if;
    if c.max_uses is not null and c.used_count >= c.max_uses then raise exception 'El cupón alcanzó su límite de usos'; end if;
    if c.min_amount is not null and v_subtotal < c.min_amount then raise exception 'La compra no alcanza el mínimo del cupón'; end if;
    if c.discount_type = 'percent' then v_discount := round(v_subtotal * c.discount_value / 100);
    else v_discount := c.discount_value; end if;
    if v_discount > v_subtotal then v_discount := v_subtotal; end if;
    update public.coupons set used_count = used_count + 1 where id = p_coupon_id;
  end if;

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
    select balance into v_balance from public.customers where id = p_customer_id and organization_id = v_org;
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
          p_coupon_id, v_subtotal, v_discount, v_total, greatest(0, v_total - v_cc),
          nullif(trim(coalesce(p_customer_data->>'name','')),''),
          nullif(trim(coalesce(p_customer_data->>'doc','')),''),
          nullif(trim(coalesce(p_customer_data->>'phone','')),''),
          nullif(trim(coalesce(p_customer_data->>'email','')),''),
          auth.uid())
  returning id into v_sale;

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

-- ── create_exchange: la venta-cambio fija paid_amount = total − fiado ──────────
create or replace function public.create_exchange(
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_customer_id     uuid,
  p_scope_sale      uuid,
  p_returned        jsonb,
  p_price_list_id   uuid,
  p_new_items       jsonb,
  p_diff_payments   jsonb
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid;
  v_credit numeric := 0; v_new_total numeric := 0; v_applied numeric; v_leftover numeric; v_diff numeric;
  v_real numeric := 0; v_cc numeric := 0; v_paid numeric := 0;
  v_cambio uuid; v_new_sale uuid;
  v_el jsonb; v_variant uuid; v_need integer; v_lot record; v_take integer; v_qty integer;
  v_have numeric; v_res numeric;
  v_kind text; v_amt numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if (p_customer_id is null) = (p_scope_sale is null) then
    raise exception 'Definí el alcance: cliente (mayorista) o ticket (minorista)';
  end if;

  select warehouse_id into v_wh from public.stores where id = p_store_id and organization_id = v_org;
  if v_wh is null then raise exception 'Local inválido'; end if;

  if p_returned is null or jsonb_array_length(p_returned) = 0 then raise exception 'No escaneaste ninguna prenda a devolver'; end if;
  for v_el in select e from jsonb_array_elements(p_returned) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_need := (v_el->>'quantity')::integer;
    if v_need <= 0 then continue; end if;

    for v_lot in
      select si.id, si.unit_price, (si.quantity - si.returned_qty) as avail
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
      where s.organization_id = v_org and s.status = 'completada'
        and s.created_at >= now() - interval '30 days'
        and si.variant_id = v_variant
        and (si.quantity - si.returned_qty) > 0
        and ( (p_customer_id is not null and s.customer_id = p_customer_id)
           or (p_scope_sale   is not null and s.id = p_scope_sale) )
      order by s.created_at asc
      for update
    loop
      exit when v_need <= 0;
      v_take := least(v_need, v_lot.avail);
      v_credit := v_credit + v_take * v_lot.unit_price;
      update public.sale_items set returned_qty = returned_qty + v_take where id = v_lot.id;
      v_need := v_need - v_take;
    end loop;

    if v_need > 0 then
      raise exception 'No hay suficientes unidades elegibles (30 días, sin devolver) de una de las prendas escaneadas';
    end if;

    v_qty := (v_el->>'quantity')::integer;
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
      values (v_org, v_wh, v_variant, v_qty)
      on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + v_qty, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_wh, v_variant, v_qty, 'cambio', 'exchange', coalesce(p_scope_sale, p_customer_id), auth.uid());
  end loop;

  select coalesce(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    into v_new_total from jsonb_array_elements(coalesce(p_new_items,'[]'::jsonb)) e;

  for v_el in select e from jsonb_array_elements(coalesce(p_diff_payments,'[]'::jsonb)) as e
  loop
    v_amt := (v_el->>'amount')::numeric;
    select kind into v_kind from public.payment_methods where id = (v_el->>'payment_method_id')::uuid;
    if v_kind = 'cuenta_corriente' then v_cc := v_cc + v_amt; else v_real := v_real + v_amt; end if;
  end loop;
  v_paid := v_real + v_cc;

  if v_new_total = 0 then
    if p_customer_id is null then raise exception 'Elegí la prenda nueva del cambio'; end if;
    if v_paid > 0 then raise exception 'No hay diferencia a cobrar'; end if;
    update public.customers set balance = balance - v_credit where id = p_customer_id;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, -v_credit, 'cambio', 'exchange', null, auth.uid());
    insert into public.exchanges (organization_id, store_id, original_sale_id, new_sale_id, customer_id, credit, difference, forfeited, created_by)
      values (v_org, p_store_id, p_scope_sale, null, p_customer_id, v_credit, 0, 0, auth.uid());
    return null;
  end if;

  v_applied := least(v_credit, v_new_total);
  v_leftover := v_credit - v_applied;
  v_diff := v_new_total - v_applied;

  if p_customer_id is null then
    if v_cc > 0 then raise exception 'En mostrador no se puede fiar'; end if;
    if v_real < v_diff then raise exception 'Falta cobrar la diferencia'; end if;
    if v_real > v_diff then raise exception 'La diferencia cobrada es mayor a la que corresponde'; end if;
  else
    if v_paid < v_diff then raise exception 'Falta cubrir la diferencia'; end if;
    if v_paid > v_diff then raise exception 'El pago supera la diferencia'; end if;
  end if;

  select id into v_cambio from public.payment_methods where organization_id = v_org and kind = 'cambio' limit 1;
  insert into public.sales (organization_id, store_id, cash_session_id, customer_id, price_list_id, channel, subtotal, discount, total, paid_amount, created_by)
    values (v_org, p_store_id, p_cash_session_id, p_customer_id, p_price_list_id, 'cambio', v_new_total, 0, v_new_total, greatest(0, v_new_total - v_cc), auth.uid())
    returning id into v_new_sale;

  for v_el in select e from jsonb_array_elements(p_new_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;
    insert into public.sale_items (sale_id, variant_id, product_name, variant_label, quantity, unit_price, line_total)
      values (v_new_sale, v_variant, v_el->>'product_name', nullif(v_el->>'variant_label',''), v_qty, (v_el->>'unit_price')::numeric, v_qty * (v_el->>'unit_price')::numeric);

    select quantity, reserved into v_have, v_res from public.stock
      where warehouse_id = v_wh and variant_id = v_variant for update;
    if coalesce(v_have,0) - coalesce(v_res,0) < v_qty then
      raise exception 'Sin stock disponible de "%" (disponible %, se piden %)',
        coalesce(nullif(v_el->>'product_name',''), 'producto') || coalesce(' ' || nullif(v_el->>'variant_label',''), ''),
        coalesce(v_have,0) - coalesce(v_res,0), v_qty;
    end if;
    update public.stock set quantity = v_have - v_qty, updated_at = now()
      where warehouse_id = v_wh and variant_id = v_variant;
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_wh, v_variant, -v_qty, 'venta', 'sale', v_new_sale, auth.uid());
  end loop;

  if v_applied > 0 and v_cambio is not null then
    insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge) values (v_new_sale, v_cambio, v_applied, 0);
  end if;
  for v_el in select e from jsonb_array_elements(coalesce(p_diff_payments,'[]'::jsonb)) as e
  loop
    insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
      values (v_new_sale, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric, 0);
  end loop;

  if p_customer_id is not null and v_cc > 0 then
    update public.customers set balance = balance + v_cc where id = p_customer_id;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, v_cc, 'venta', 'sale', v_new_sale, auth.uid());
  end if;

  if p_customer_id is not null and v_leftover > 0 then
    update public.customers set balance = balance - v_leftover where id = p_customer_id;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, -v_leftover, 'cambio', 'exchange', v_new_sale, auth.uid());
  end if;

  insert into public.exchanges (organization_id, store_id, original_sale_id, new_sale_id, customer_id, credit, difference, forfeited, created_by)
    values (v_org, p_store_id, p_scope_sale, v_new_sale, p_customer_id, v_credit, v_diff,
            case when p_customer_id is null then v_leftover else 0 end, auth.uid());

  return v_new_sale;
end; $$;

-- ── create_receipt: cobra + imputa a pedidos (sube su paid_amount) ─────────────
drop function if exists public.create_receipt(uuid, uuid, uuid, jsonb, text);
create or replace function public.create_receipt(
  p_customer        uuid,
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_payments        jsonb,   -- [{ payment_method_id, amount }]
  p_allocations     jsonb,   -- [{ sale_id, amount }] imputación a pedidos (opcional)
  p_notes           text
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_receipt uuid; v_total numeric := 0; v_alloc_total numeric := 0; v_el jsonb;
  v_sale uuid; v_amt numeric; v_remaining numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_payments is null or jsonb_array_length(p_payments) = 0 then raise exception 'La cobranza no tiene medios de pago'; end if;

  select coalesce(sum((e->>'amount')::numeric), 0) into v_total from jsonb_array_elements(p_payments) e;
  if v_total <= 0 then raise exception 'El monto a cobrar debe ser mayor a cero'; end if;

  select coalesce(sum((e->>'amount')::numeric), 0) into v_alloc_total
    from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) e;
  if v_alloc_total > v_total + 0.01 then raise exception 'Estás imputando a pedidos más de lo que cobrás'; end if;

  insert into public.receipts (organization_id, customer_id, store_id, cash_session_id, total, notes, created_by)
  values (v_org, p_customer, p_store_id, p_cash_session_id, v_total, nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  returning id into v_receipt;

  for v_el in select e from jsonb_array_elements(p_payments) as e
  loop
    insert into public.receipt_payments (receipt_id, payment_method_id, amount)
    values (v_receipt, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric);
  end loop;

  -- Imputación a pedidos: sube paid_amount de cada uno (sin pasarse de lo que debe).
  for v_el in select e from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) as e
  loop
    v_sale := (v_el->>'sale_id')::uuid;
    v_amt := (v_el->>'amount')::numeric;
    if v_amt is null or v_amt <= 0 then continue; end if;
    select (total - paid_amount) into v_remaining from public.sales
      where id = v_sale and organization_id = v_org and customer_id = p_customer and status = 'completada' for update;
    if v_remaining is null then raise exception 'Pedido a imputar inválido'; end if;
    if v_amt > v_remaining + 0.01 then raise exception 'Imputás a un pedido más de lo que debe'; end if;
    update public.sales set paid_amount = paid_amount + v_amt where id = v_sale;
    insert into public.receipt_allocations (receipt_id, sale_id, amount) values (v_receipt, v_sale, v_amt);
  end loop;

  update public.customers set balance = balance - v_total where id = p_customer;
  insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
  values (v_org, p_customer, -v_total, 'cobranza', 'receipt', v_receipt, auth.uid());

  return v_receipt;
end; $$;

-- ── dispatch_sale: candado "no despachar sin pago" ────────────────────────────
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
    and s.status = 'completada' and s.fulfillment_status = 'controlado';
  if v_wh is null then raise exception 'El pedido no está listo para despachar'; end if;

  -- Candado: no se despacha un pedido que no esté pago.
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
