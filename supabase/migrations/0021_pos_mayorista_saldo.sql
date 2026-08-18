-- 0021_pos_mayorista_saldo.sql — Flujo mayorista vs consumidor final + saldo a favor.
--  • stores.is_wholesale: distingue sucursales mayoristas (cliente obligatorio).
--  • sales: snapshot opcional de datos del consumidor final (para futura factura).
--  • payment_methods: nuevo kind 'saldo_favor' + medio "Saldo a favor".
--  • create_sale v3: acepta datos del cliente (snapshot), permite pagar con saldo a
--    favor (consume crédito) y sobrepago (excedente en efectivo → saldo a favor).
--    El sobrepago/crédito sólo aplica a ventas con cliente (mayorista).
-- Append-only e idempotente.

-- ── 1. Sucursales mayoristas ─────────────────────────────────
alter table public.stores add column if not exists is_wholesale boolean not null default false;
update public.stores set is_wholesale = true
  where name in ('Mayorista - Local', 'Mayorista - Central') and is_wholesale = false;

-- ── 2. Snapshot del consumidor final en la venta ─────────────
alter table public.sales add column if not exists customer_name  text;
alter table public.sales add column if not exists customer_doc    text;
alter table public.sales add column if not exists customer_phone  text;
alter table public.sales add column if not exists customer_email  text;

-- Búsqueda de clientes mayoristas por documento.
create index if not exists customers_doc_idx on public.customers (organization_id, doc_number);

-- ── 3. Medio de pago "Saldo a favor" ─────────────────────────
alter table public.payment_methods drop constraint if exists payment_methods_kind_check;
alter table public.payment_methods add constraint payment_methods_kind_check
  check (kind in ('efectivo','tarjeta','transferencia','digital','cuenta_corriente','saldo_favor','otro'));

insert into public.payment_methods (organization_id, name, kind, affects_cash, position)
select o.id, 'Saldo a favor', 'saldo_favor', false, 7
from public.organizations o
where o.name = 'Bodysculpt'
on conflict (organization_id, name) do nothing;

-- ── 4. create_sale v3 ────────────────────────────────────────
drop function if exists public.create_sale(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb);
create or replace function public.create_sale(
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_customer_id     uuid,
  p_price_list_id   uuid,
  p_coupon_id       uuid,
  p_customer_data   jsonb,   -- { name, doc, phone, email } (consumidor final) o null
  p_items           jsonb,
  p_payments        jsonb    -- [{ payment_method_id, amount, surcharge }]
) returns uuid language plpgsql as $$
declare
  v_org      uuid := public.current_org_id();
  v_wh       uuid;
  v_sale     uuid;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total    numeric := 0;
  v_el       jsonb;
  v_qty      integer;
  v_variant  uuid;
  c          record;
  v_cc       numeric := 0;   -- fiado (cuenta corriente)
  v_credit   numeric := 0;   -- pagado con saldo a favor
  v_real     numeric := 0;   -- efectivo/tarjeta/etc.
  v_kind     text;
  v_amt      numeric;
  v_balance  numeric;
  v_due_acct numeric;
  v_excess   numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select warehouse_id into v_wh from public.stores where id = p_store_id and organization_id = v_org;
  if v_wh is null then raise exception 'Local inválido'; end if;

  select coalesce(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) e;

  -- Cupón.
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

  -- Clasificar los pagos por tipo.
  for v_el in select e from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) as e
  loop
    v_amt := (v_el->>'amount')::numeric;
    select kind into v_kind from public.payment_methods where id = (v_el->>'payment_method_id')::uuid;
    if v_kind = 'cuenta_corriente' then v_cc := v_cc + v_amt;
    elsif v_kind = 'saldo_favor' then v_credit := v_credit + v_amt;
    else v_real := v_real + v_amt;
    end if;
  end loop;

  -- Fiado y saldo a favor requieren cliente.
  if (v_cc > 0 or v_credit > 0) and p_customer_id is null then
    raise exception 'Fiar o usar saldo a favor requiere un cliente identificado';
  end if;

  -- Saldo a favor: no puede exceder el crédito disponible.
  if v_credit > 0 then
    select balance into v_balance from public.customers where id = p_customer_id and organization_id = v_org;
    if v_credit > greatest(0, -coalesce(v_balance,0)) then
      raise exception 'El saldo a favor disponible no alcanza';
    end if;
  end if;

  -- Cobertura del total: lo que no cubre la cuenta debe cubrirlo el efectivo/tarjeta.
  v_due_acct := v_total - v_cc - v_credit;
  if v_due_acct < 0 then raise exception 'Los pagos a cuenta superan el total'; end if;
  if v_real < v_due_acct then raise exception 'Pago insuficiente'; end if;
  v_excess := v_real - v_due_acct;   -- excedente de efectivo/tarjeta
  if v_excess > 0 and p_customer_id is null then
    raise exception 'El excedente requiere un cliente (en mostrador se cobra exacto)';
  end if;

  insert into public.sales (organization_id, store_id, cash_session_id, customer_id, price_list_id,
                            coupon_id, subtotal, discount, total,
                            customer_name, customer_doc, customer_phone, customer_email, created_by)
  values (v_org, p_store_id, p_cash_session_id, p_customer_id, p_price_list_id,
          p_coupon_id, v_subtotal, v_discount, v_total,
          nullif(trim(coalesce(p_customer_data->>'name','')),''),
          nullif(trim(coalesce(p_customer_data->>'doc','')),''),
          nullif(trim(coalesce(p_customer_data->>'phone','')),''),
          nullif(trim(coalesce(p_customer_data->>'email','')),''),
          auth.uid())
  returning id into v_sale;

  -- Ítems + stock.
  for v_el in select e from jsonb_array_elements(p_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;
    insert into public.sale_items (sale_id, variant_id, product_name, variant_label, quantity, unit_price, line_total)
    values (v_sale, v_variant, v_el->>'product_name', nullif(v_el->>'variant_label',''),
            v_qty, (v_el->>'unit_price')::numeric, v_qty * (v_el->>'unit_price')::numeric);
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, v_wh, v_variant, -v_qty)
    on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity - v_qty, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_wh, v_variant, -v_qty, 'venta', 'sale', v_sale, auth.uid());
  end loop;

  -- Pagos.
  for v_el in select e from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) as e
  loop
    insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
    values (v_sale, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric,
            coalesce((v_el->>'surcharge')::numeric, 0));
  end loop;

  -- Movimientos de cuenta corriente.
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

-- ── cancel_sale v2: revierte el neto de cuenta corriente (fiado, saldo a favor,
--    sobrepago) y devuelve el uso del cupón. ───────────────────
create or replace function public.cancel_sale(p_sale_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_customer uuid; v_coupon uuid; v_it record; v_net numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select s.customer_id, s.coupon_id, st.warehouse_id into v_customer, v_coupon, v_wh
  from public.sales s join public.stores st on st.id = s.store_id
  where s.id = p_sale_id and s.organization_id = v_org and s.status = 'completada';
  if not found then raise exception 'Venta no encontrada o ya anulada'; end if;

  -- Reponer stock.
  for v_it in select variant_id, quantity from public.sale_items where sale_id = p_sale_id
  loop
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, v_wh, v_it.variant_id, v_it.quantity)
    on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + v_it.quantity, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_wh, v_it.variant_id, v_it.quantity, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
  end loop;

  -- Revertir el neto de los movimientos de cuenta corriente de esta venta.
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
