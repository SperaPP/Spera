-- 0110_guards_rpc_ventas_inventario.sql — auditoría de sistema #1 (+#3, #7, #8).
--
-- #1  Varias RPC validaban solo la organización y dejaban el permiso de rol para la
--     UI (requireCan). Como la anon key viaja en el browser, un usuario autenticado
--     podía llamarlas directo por PostgREST y saltear el rol. 0071 cerró las
--     destructivas; acá se cierran las que faltaban: create_sale, create_receipt,
--     adjust_customer_balance, send_transfer, receive_transfer, accept_replenishment,
--     import_products. (open/close de caja van en 0111.)
--     Patrón null-safe `auth.uid() is not null and not has_perm(...)`: un usuario
--     autenticado sin permiso es rechazado; el service-role (uid null, usado por
--     procesos server/cron) pasa, igual que guard_profile_privileges (0064).
-- #3  create_sale: deduplica los cupones (couponIds [X,X] aplicaba el descuento y el
--     used_count dos veces y burlaba max_uses).
-- #7  accept_replenishment: si no se eligió ningún ítem ya no borra TODO el pendiente
--     del local (antes se perdía el acumulado sin generar transferencia).
-- #8  deliver_to_central: exige 'caja_admin' (coherente con su action), no 'caja'.
-- Cuerpos tomados de su versión vigente. Append-only e idempotente.

-- ── create_sale: guard 'pos' + dedup de cupones ──────────────
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
  if auth.uid() is not null and not public.has_perm('pos', true) then
    raise exception 'No tenés permiso para registrar ventas';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select warehouse_id, coalesce(is_wholesale,false) into v_wh, v_wholesale
    from public.stores where id = p_store_id and organization_id = v_org;
  if v_wh is null then raise exception 'Local inválido'; end if;

  select coalesce(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) e;

  -- Cupones: usa p_coupon_ids si viene; si no, cae a p_coupon_id (retrocompat).
  v_coupon_ids := coalesce(p_coupon_ids,
    case when p_coupon_id is not null then jsonb_build_array(p_coupon_id) else '[]'::jsonb end);

  -- #3: distinct → un mismo cupón no descuenta ni suma uso dos veces.
  for v_txt in select distinct value from jsonb_array_elements_text(v_coupon_ids) loop
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

  for v_txt in select distinct value from jsonb_array_elements_text(v_coupon_ids) loop
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

-- ── create_receipt: guard 'cobranzas' ────────────────────────
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
  v_real numeric := 0; v_credit numeric := 0; v_unpaid numeric := 0; v_balance numeric := 0;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  if auth.uid() is not null and not public.has_perm('cobranzas', true) then
    raise exception 'No tenés permiso para registrar cobranzas';
  end if;
  if p_payments is null or jsonb_array_length(p_payments) = 0 then raise exception 'La cobranza no tiene medios de pago'; end if;

  if exists (select 1 from jsonb_array_elements(p_payments) e where coalesce((e->>'amount')::numeric, 0) <= 0) then
    raise exception 'Los montos de la cobranza deben ser positivos';
  end if;

  -- Cuenta corriente y cambio no pueden pagar una cobranza. Saldo a favor SÍ (abajo
  -- se trata aparte: no es dinero real, no mueve caja ni saldo).
  if exists (
    select 1 from jsonb_array_elements(p_payments) e
    join public.payment_methods pm on pm.id = (e->>'payment_method_id')::uuid
    where pm.kind in ('cuenta_corriente', 'cambio')
  ) then
    raise exception 'Medio de pago inválido para una cobranza';
  end if;

  -- Reparte el total en dinero real vs saldo a favor.
  for v_el in select e from jsonb_array_elements(p_payments) as e loop
    if exists (select 1 from public.payment_methods pm where pm.id = (v_el->>'payment_method_id')::uuid and pm.kind = 'saldo_favor') then
      v_credit := v_credit + (v_el->>'amount')::numeric;
    else
      v_real := v_real + (v_el->>'amount')::numeric;
    end if;
  end loop;

  -- Saldo a favor disponible = lo impago de sus pedidos menos lo que debe en cta cte.
  if v_credit > 0 then
    select coalesce(sum(total - paid_amount), 0) into v_unpaid
      from public.sales where organization_id = v_org and customer_id = p_customer and status = 'completada';
    select balance into v_balance from public.customers where id = p_customer and organization_id = v_org for update;
    if v_credit > greatest(0, v_unpaid - coalesce(v_balance, 0)) + 0.01 then
      raise exception 'El saldo a favor disponible no alcanza (disponible %)',
        to_char(greatest(0, v_unpaid - coalesce(v_balance, 0)), 'FM999999990.00');
    end if;
  end if;

  -- Caja abierta solo si algún medio suma al arqueo (el saldo a favor no).
  if exists (
    select 1 from jsonb_array_elements(p_payments) e
    join public.payment_methods pm on pm.id = (e->>'payment_method_id')::uuid
    where pm.affects_cash
  ) then
    if p_cash_session_id is null then raise exception 'La cobranza con efectivo necesita una caja abierta'; end if;
    if not exists (
      select 1 from public.cash_sessions
      where id = p_cash_session_id and organization_id = v_org and store_id = p_store_id and status = 'abierta'
    ) then raise exception 'La caja indicada no está abierta o no pertenece a este local'; end if;
  end if;

  v_total := v_real + v_credit;
  if v_total <= 0 then raise exception 'El monto a cobrar debe ser mayor a cero'; end if;

  select coalesce(sum((e->>'amount')::numeric), 0) into v_alloc_total
    from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) e;
  if v_alloc_total > v_total + 0.01 then raise exception 'Estás imputando a pedidos más de lo que cobrás'; end if;
  -- El saldo a favor solo tiene sentido imputado a pedidos (no deja "saldo del saldo").
  if v_credit > v_alloc_total + 0.01 then
    raise exception 'El saldo a favor tiene que imputarse a pedidos (imputá al menos %)',
      to_char(v_credit, 'FM999999990.00');
  end if;

  insert into public.receipts (organization_id, customer_id, store_id, cash_session_id, total, notes, created_by)
  values (v_org, p_customer, p_store_id, p_cash_session_id, v_total, nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  returning id into v_receipt;

  for v_el in select e from jsonb_array_elements(p_payments) as e loop
    insert into public.receipt_payments (receipt_id, payment_method_id, amount)
    values (v_receipt, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric);
  end loop;

  for v_el in select e from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) as e loop
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

  -- Solo el dinero REAL baja el saldo de cuenta corriente.
  if v_real > 0 then
    update public.customers set balance = balance - v_real where id = p_customer;
    insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, p_customer, -v_real, 'cobranza', 'receipt', v_receipt, auth.uid());
  end if;

  return v_receipt;
end; $$;

-- ── adjust_customer_balance: guard admin ─────────────────────
create or replace function public.adjust_customer_balance(p_customer_id uuid, p_delta numeric, p_reason text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Solo un administrador puede ajustar el saldo de un cliente';
  end if;
  if p_delta = 0 then raise exception 'El ajuste no puede ser cero'; end if;

  update public.customers set balance = balance + p_delta
    where id = p_customer_id and organization_id = v_org;
  if not found then raise exception 'Cliente no encontrado'; end if;

  insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, note, created_by)
  values (v_org, p_customer_id, p_delta, 'ajuste', 'adjustment', nullif(trim(coalesce(p_reason,'')),''), auth.uid());
end $$;

-- ── send_transfer: guard 'transferencias' ────────────────────
create or replace function public.send_transfer(p_transfer_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_from uuid; v_it record; v_have integer;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if auth.uid() is not null and not public.has_perm('transferencias', true) then
    raise exception 'No tenés permiso para enviar transferencias';
  end if;
  select from_warehouse_id into v_from from public.stock_transfers
    where id = p_transfer_id and organization_id = v_org and status = 'creada' for update;
  if not found then raise exception 'Transferencia no encontrada o ya enviada'; end if;

  for v_it in select variant_id, quantity from public.stock_transfer_items where transfer_id = p_transfer_id
  loop
    select quantity into v_have from public.stock where warehouse_id = v_from and variant_id = v_it.variant_id for update;
    if coalesce(v_have,0) < v_it.quantity then
      raise exception 'No hay stock físico para enviar una de las prendas';
    end if;
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

-- ── receive_transfer: guard 'transferencias' ─────────────────
create or replace function public.receive_transfer(p_transfer_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_to uuid; v_it record;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if auth.uid() is not null and not public.has_perm('transferencias', true) then
    raise exception 'No tenés permiso para recibir transferencias';
  end if;
  select to_warehouse_id into v_to from public.stock_transfers
    where id = p_transfer_id and organization_id = v_org and status = 'enviada'
    for update;   -- serializa recepciones concurrentes (anti doble-recepción)
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

-- ── accept_replenishment: guard 'reposiciones' + #7 no-borrar-si-vacío ──
create or replace function public.accept_replenishment(p_store_id uuid, p_items jsonb)
returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_store_wh uuid; v_central_wh uuid;
  v_el jsonb; v_variant uuid; v_qty integer; v_pending integer; v_avail integer; v_res integer;
  v_pname text; v_items jsonb := '[]'::jsonb; v_transfer uuid;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if auth.uid() is not null and not public.has_perm('reposiciones', true) then
    raise exception 'No tenés permiso para aceptar reposiciones';
  end if;

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

  -- #7: si no se eligió nada, NO se toca el pendiente (antes se borraba todo el
  -- acumulado del local sin generar ninguna transferencia → pérdida silenciosa).
  if jsonb_array_length(v_items) = 0 then
    raise exception 'Elegí al menos una prenda para reponer';
  end if;

  -- Crea la transferencia Central → mostrador (proceso normal de dos fases).
  v_transfer := public.create_transfer(v_central_wh, v_store_wh, v_items, 'Reposición de mostrador');

  -- Descarta TODO el pendiente del local (lo elegido se transfirió; el resto se descarta).
  delete from public.replenishment_pending where store_id = p_store_id;

  return v_transfer;
end; $$;

-- ── import_products: guard 'productos' ───────────────────────
create or replace function public.import_products(p_rows jsonb, p_warehouse uuid)
returns jsonb language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_pname text; v_first jsonb; v_el jsonb; v_name text;
  v_maincat uuid; v_cat uuid; v_season uuid; v_fabric uuid;
  v_has_size boolean; v_has_color boolean; v_vartype text; v_dest boolean;
  v_desc text; v_price numeric; v_product uuid; v_variant uuid;
  v_talle text; v_color text; v_sku text; v_stock integer;
  v_fila int; v_est int; v_cub int;
  v_prods int := 0; v_vars int := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if auth.uid() is not null and not public.has_perm('productos', true) then
    raise exception 'No tenés permiso para importar productos';
  end if;
  if p_warehouse is null then raise exception 'Elegí el depósito para el stock inicial'; end if;

  for v_pname in
    select distinct trim(e->>'producto') from jsonb_array_elements(p_rows) e
    where nullif(trim(e->>'producto'), '') is not null
  loop
    select e into v_first from jsonb_array_elements(p_rows) with ordinality t(e, ord)
      where trim(e->>'producto') = v_pname order by ord limit 1;

    v_maincat := null; v_name := nullif(trim(v_first->>'categoria_principal'), '');
    if v_name is not null then
      select id into v_maincat from public.main_categories where organization_id = v_org and lower(name) = lower(v_name);
      if v_maincat is null then insert into public.main_categories (organization_id, name) values (v_org, v_name) returning id into v_maincat; end if;
    end if;
    v_cat := null; v_name := nullif(trim(v_first->>'categoria'), '');
    if v_name is not null then
      select id into v_cat from public.categories where organization_id = v_org and lower(name) = lower(v_name);
      if v_cat is null then insert into public.categories (organization_id, name) values (v_org, v_name) returning id into v_cat; end if;
    end if;
    v_season := null; v_name := nullif(trim(v_first->>'temporada'), '');
    if v_name is not null then
      select id into v_season from public.seasons where organization_id = v_org and lower(name) = lower(v_name);
      if v_season is null then insert into public.seasons (organization_id, name) values (v_org, v_name) returning id into v_season; end if;
    end if;
    v_fabric := null; v_name := nullif(trim(v_first->>'tela'), '');
    if v_name is not null then
      select id into v_fabric from public.fabric_types where organization_id = v_org and lower(name) = lower(v_name);
      if v_fabric is null then insert into public.fabric_types (organization_id, name) values (v_org, v_name) returning id into v_fabric; end if;
    end if;

    select bool_or(nullif(trim(e->>'talle'), '') is not null), bool_or(nullif(trim(e->>'color'), '') is not null)
      into v_has_size, v_has_color
    from jsonb_array_elements(p_rows) e where trim(e->>'producto') = v_pname;
    v_vartype := case when v_has_size and v_has_color then 'size_color'
                      when v_has_size then 'size' when v_has_color then 'color' else 'none' end;

    v_desc := nullif(trim(v_first->>'descripcion'), '');
    v_dest := lower(coalesce(trim(v_first->>'destacado'), '')) in ('1', 'si', 'sí', 's', 'x', 'true', 'verdadero', 'y', 'yes', 'sim');

    insert into public.products (organization_id, name, description, category_id, main_category_id, season_id, fabric_type_id, brand, variation_type, tax_rate, lifecycle, active, featured)
    values (v_org, v_pname, v_desc, v_cat, v_maincat, v_season, v_fabric, 'Bodysculpt', v_vartype, 21, 'actual', true, v_dest)
    returning id into v_product;
    v_prods := v_prods + 1;

    for v_el in select e from jsonb_array_elements(p_rows) with ordinality t(e, ord)
                where trim(e->>'producto') = v_pname order by ord
    loop
      v_sku := nullif(trim(v_el->>'sku'), '');
      if v_sku is null then continue; end if;
      if exists (select 1 from public.product_variants where organization_id = v_org and sku = v_sku) then
        raise exception 'El SKU % está repetido (ya existe o está dos veces en el archivo)', v_sku;
      end if;

      v_talle := nullif(trim(v_el->>'talle'), '');
      v_color := nullif(trim(v_el->>'color'), '');
      if v_talle is not null then insert into public.sizes (organization_id, name) values (v_org, v_talle) on conflict (organization_id, name) do nothing; end if;
      if v_color is not null then insert into public.colors (organization_id, name) values (v_org, v_color) on conflict (organization_id, name) do nothing; end if;

      v_fila := case when trim(coalesce(v_el->>'fila', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then floor(trim(v_el->>'fila')::numeric)::int else null end;
      v_est  := case when trim(coalesce(v_el->>'estante', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then floor(trim(v_el->>'estante')::numeric)::int else null end;
      v_cub  := case when trim(coalesce(v_el->>'cubiculo', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then floor(trim(v_el->>'cubiculo')::numeric)::int else null end;

      insert into public.product_variants (organization_id, product_id, size, color, sku, barcode, active, loc_fila, loc_estante, loc_cubiculo)
      values (v_org, v_product, v_talle, v_color, v_sku, v_sku, true, v_fila, v_est, v_cub)
      returning id into v_variant;
      v_vars := v_vars + 1;

      v_stock := case when trim(coalesce(v_el->>'stock', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then floor(trim(v_el->>'stock')::numeric)::int else 0 end;
      if v_stock > 0 then
        insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
        values (v_org, p_warehouse, v_variant, v_stock)
        on conflict (warehouse_id, variant_id) do update set quantity = public.stock.quantity + v_stock, updated_at = now();
        insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
        values (v_org, p_warehouse, v_variant, v_stock, 'stock_inicial', 'product_import', v_product, auth.uid());
      end if;
    end loop;

    select trim(e->>'precio_mayorista')::numeric into v_price
    from jsonb_array_elements(p_rows) e
    where trim(e->>'producto') = v_pname and trim(coalesce(e->>'precio_mayorista', '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
    limit 1;
    if v_price is not null and v_price > 0 then
      perform public.apply_product_pricing(v_product, v_price);
    end if;
  end loop;

  return jsonb_build_object('productos', v_prods, 'variantes', v_vars);
end; $$;

-- ── deliver_to_central: #8 exige 'caja_admin' (coherente con el action) ──
create or replace function public.deliver_to_central(p_store_id uuid, p_amount numeric, p_notes text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_bal numeric;
begin
  if auth.uid() is not null and not public.has_perm('caja_admin', true) then
    raise exception 'No tenés permiso para entregar a central';
  end if;
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_amount <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  select balance into v_bal from public.store_safe where store_id = p_store_id and organization_id = v_org for update;
  if coalesce(v_bal, 0) < p_amount then raise exception 'La caja fuerte no tiene ese monto (hay %)', coalesce(v_bal,0); end if;
  update public.store_safe set balance = balance - p_amount, updated_at = now() where store_id = p_store_id;
  insert into public.central_deliveries (organization_id, store_id, amount, notes, delivered_by)
  values (v_org, p_store_id, p_amount, nullif(trim(coalesce(p_notes,'')),''), auth.uid());
end; $$;

notify pgrst, 'reload schema';
