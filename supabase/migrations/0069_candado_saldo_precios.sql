-- 0069_candado_saldo_precios.sql — protege customers.balance y precios (auditoria).
--
-- customers.balance solo puede cambiarlo una RPC de negocio (venta, cobranza, cambio,
-- anulacion, devolucion, ajuste, pedido de portal): cada una setea el flag de
-- transaccion app.cust_bal=1 y un trigger bloquea cualquier UPDATE de balance sin ese
-- flag. Asi un empleado NO puede alterar la deuda de un cliente por API directa, y
-- ningun flujo legitimo se rompe (la RPC habilita el flag).
-- price_list_items: escritura solo para roles con permiso de precios o productos.
-- Append-only e idempotente. (Cuerpos de las RPC extraidos de su version vigente.)

create or replace function public.guard_customer_balance() returns trigger
language plpgsql as $$
begin
  if new.balance is distinct from old.balance
     and coalesce(current_setting('app.cust_bal', true), '') <> '1' then
    raise exception 'El saldo del cliente solo se modifica por ventas, cobranzas o ajustes';
  end if;
  return new;
end; $$;
drop trigger if exists customers_guard_balance on public.customers;
create trigger customers_guard_balance before update on public.customers
  for each row execute function public.guard_customer_balance();

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
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
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
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
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
        and s.fulfillment_status in ('entregado', 'despachado')  -- solo se devuelve lo que fisicamente salio
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

  if v_coupon is not null then
    update public.coupons set used_count = greatest(used_count - 1, 0) where id = v_coupon;
  end if;

  update public.sales set status = 'anulada' where id = p_sale_id;
end; $$;

create or replace function public.create_receipt(
  p_customer        uuid,
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_payments        jsonb,
  p_allocations     jsonb,
  p_notes           text
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_receipt uuid; v_total numeric := 0; v_alloc_total numeric := 0; v_el jsonb;
  v_sale uuid; v_amt numeric; v_remaining numeric;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_payments is null or jsonb_array_length(p_payments) = 0 then raise exception 'La cobranza no tiene medios de pago'; end if;

  -- Ningún monto puede ser cero o negativo (defensa en profundidad).
  if exists (select 1 from jsonb_array_elements(p_payments) e where coalesce((e->>'amount')::numeric, 0) <= 0) then
    raise exception 'Los montos de la cobranza deben ser positivos';
  end if;

  -- Una cobranza es dinero real; no se paga con cuenta corriente / saldo a favor / cambio.
  if exists (
    select 1 from jsonb_array_elements(p_payments) e
    join public.payment_methods pm on pm.id = (e->>'payment_method_id')::uuid
    where pm.kind in ('cuenta_corriente', 'saldo_favor', 'cambio')
  ) then
    raise exception 'Medio de pago inválido para una cobranza (no es dinero real)';
  end if;

  -- Si algún medio suma al arqueo, exigir una caja ABIERTA del mismo local (si no,
  -- el efectivo cobrado quedaría fuera de todo arqueo).
  if exists (
    select 1 from jsonb_array_elements(p_payments) e
    join public.payment_methods pm on pm.id = (e->>'payment_method_id')::uuid
    where pm.affects_cash
  ) then
    if p_cash_session_id is null then
      raise exception 'La cobranza con efectivo necesita una caja abierta';
    end if;
    if not exists (
      select 1 from public.cash_sessions
      where id = p_cash_session_id and organization_id = v_org
        and store_id = p_store_id and status = 'abierta'
    ) then
      raise exception 'La caja indicada no está abierta o no pertenece a este local';
    end if;
  end if;

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

create or replace function public.cancel_receipt(p_receipt_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_customer uuid; v_total numeric; v_al record;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;

  select customer_id, total into v_customer, v_total from public.receipts
    where id = p_receipt_id and organization_id = v_org and status <> 'anulada' for update;
  if not found then raise exception 'Cobranza no encontrada o ya anulada'; end if;

  -- Si pagó un pedido que ya se despachó, no se puede anular (la mercadería salió).
  if exists (
    select 1 from public.receipt_allocations ra
    join public.sales s on s.id = ra.sale_id
    where ra.receipt_id = p_receipt_id and s.fulfillment_status = 'despachado'
  ) then
    raise exception 'Esta cobranza pagó un pedido que ya fue despachado; no se puede anular.';
  end if;

  for v_al in select sale_id, amount from public.receipt_allocations where receipt_id = p_receipt_id
  loop
    update public.sales set paid_amount = greatest(paid_amount - v_al.amount, 0) where id = v_al.sale_id;
  end loop;

  if v_customer is not null then
    update public.customers set balance = balance + v_total where id = v_customer;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_customer, v_total, 'anulacion', 'receipt', p_receipt_id, auth.uid());
  end if;

  update public.receipts set status = 'anulada' where id = p_receipt_id;
end; $$;

create or replace function public.adjust_customer_balance(p_customer_id uuid, p_delta numeric, p_reason text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_delta = 0 then raise exception 'El ajuste no puede ser cero'; end if;

  update public.customers set balance = balance + p_delta
    where id = p_customer_id and organization_id = v_org;
  if not found then raise exception 'Cliente no encontrado'; end if;

  insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, note, created_by)
  values (v_org, p_customer_id, p_delta, 'ajuste', 'adjustment', nullif(trim(coalesce(p_reason,'')),''), auth.uid());
end $$;

create or replace function public.portal_create_order(p_customer uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_list uuid; v_store uuid; v_wh uuid; v_sale uuid;
  v_total numeric := 0;
  v_el jsonb; v_variant uuid; v_qty integer; v_pid uuid; v_price numeric; v_avail numeric; v_res numeric;
  v_pname text; v_vlabel text;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El pedido está vacío'; end if;

  select c.organization_id, ct.price_list_id
    into v_org, v_list
  from public.customers c
  left join public.customer_types ct on ct.id = c.customer_type_id
  where c.id = p_customer and c.auth_user_id = auth.uid() and c.portal_status = 'aprobado';
  if v_org is null then raise exception 'No autorizado'; end if;
  if v_list is null then raise exception 'Tu cuenta no tiene lista de precios asignada'; end if;

  select st.id, st.warehouse_id into v_store, v_wh
  from public.stores st join public.warehouses w on w.id = st.warehouse_id
  where st.organization_id = v_org and w.name = 'Mayorista - Central'
  order by st.name limit 1;
  if v_store is null then raise exception 'No hay depósito Mayorista-Central configurado'; end if;

  insert into public.sales (organization_id, store_id, customer_id, price_list_id, channel, subtotal, discount, total)
  values (v_org, v_store, p_customer, v_list, 'portal', 0, 0, 0)
  returning id into v_sale;

  for v_el in select e from jsonb_array_elements(p_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then continue; end if;

    select v.product_id, p.name,
           nullif(concat_ws(' / ', nullif(v.size,''), nullif(v.color,'')), '')
      into v_pid, v_pname, v_vlabel
    from public.product_variants v join public.products p on p.id = v.product_id
    where v.id = v_variant and p.organization_id = v_org;
    if v_pid is null then raise exception 'Producto inválido en el pedido'; end if;

    select price into v_price from public.price_list_items
    where price_list_id = v_list and product_id = v_pid and variant_id is null;
    if v_price is null then raise exception 'El producto "%" no tiene precio para tu lista', v_pname; end if;

    -- Stock DISPONIBLE en Central (físico − reservado).
    select quantity, reserved into v_avail, v_res from public.stock where warehouse_id = v_wh and variant_id = v_variant for update;
    if coalesce(v_avail,0) - coalesce(v_res,0) < v_qty then
      raise exception 'Stock insuficiente de "%" (disponible %, pediste %)', coalesce(v_vlabel, v_pname), coalesce(v_avail,0) - coalesce(v_res,0), v_qty;
    end if;

    insert into public.sale_items (sale_id, variant_id, product_name, variant_label, quantity, unit_price, line_total)
    values (v_sale, v_variant, v_pname, v_vlabel, v_qty, v_price, v_qty * v_price);

    -- Reserva (el físico queda hasta el despacho).
    update public.stock set reserved = coalesce(reserved,0) + v_qty, updated_at = now()
      where warehouse_id = v_wh and variant_id = v_variant;

    v_total := v_total + v_qty * v_price;
  end loop;

  if v_total <= 0 then raise exception 'El pedido no tiene ítems válidos'; end if;

  update public.sales set subtotal = v_total, total = v_total where id = v_sale;

  update public.customers set balance = balance + v_total where id = p_customer;
  insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id)
  values (v_org, p_customer, v_total, 'venta', 'sale', v_sale);

  return v_sale;
end; $$;

create or replace function public.approve_return(p_return_id uuid)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_wh uuid; v_customer uuid; v_total numeric; v_it record;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;

  select r.customer_id, r.total, st.warehouse_id into v_customer, v_total, v_wh
  from public.returns r join public.stores st on st.id = r.store_id
  where r.id = p_return_id and r.organization_id = v_org and r.status = 'pendiente';
  if not found then raise exception 'Devolución no encontrada o ya procesada'; end if;

  for v_it in select variant_id, quantity from public.return_items where return_id = p_return_id
  loop
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, v_wh, v_it.variant_id, v_it.quantity)
    on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + v_it.quantity, updated_at = now();

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_wh, v_it.variant_id, v_it.quantity, 'devolucion', 'return', p_return_id, auth.uid());
  end loop;

  -- Saldo a favor: baja el balance del cliente (negativo = a favor)
  update public.customers set balance = balance - v_total where id = v_customer;
  insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
  values (v_org, v_customer, -v_total, 'devolucion', 'return', p_return_id, auth.uid());

  update public.returns set status = 'aprobada', approved_by = auth.uid(), approved_at = now() where id = p_return_id;
end; $$;


drop policy if exists price_list_items_all on public.price_list_items;
drop policy if exists price_list_items_select on public.price_list_items;
drop policy if exists price_list_items_write on public.price_list_items;
create policy price_list_items_select on public.price_list_items for select
  using (organization_id = public.current_org_id());
create policy price_list_items_write on public.price_list_items for all
  using (organization_id = public.current_org_id() and (public.has_perm('precios', true) or public.has_perm('productos', true)))
  with check (organization_id = public.current_org_id() and (public.has_perm('precios', true) or public.has_perm('productos', true)));
