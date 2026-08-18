-- 0020_cupones.sql — Cupones de descuento (mostrador).
--  • coupons: código único por org, % o monto fijo, opc. vencimiento / usos / mínimo.
--  • sales.coupon_id: cupón aplicado a la venta.
--  • validate_coupon: valida un código y devuelve el descuento (preview del POS).
--  • create_sale: ahora recibe p_coupon_id (reemplaza el descuento libre); valida,
--    aplica el descuento e incrementa el uso de forma atómica.
--  • cancel_sale: al anular, devuelve el uso del cupón.
-- Descuento redondeado a peso entero. Un cupón por venta. Append-only e idempotente.

create table if not exists public.coupons (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  code             text not null,
  discount_type    text not null check (discount_type in ('percent', 'amount')),
  discount_value   numeric(14,2) not null check (discount_value > 0),
  min_amount       numeric(14,2),                  -- compra mínima (opcional)
  max_uses         integer,                        -- usos totales (opcional)
  used_count       integer not null default 0,
  expires_at       date,                           -- vencimiento (opcional)
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create unique index if not exists coupons_code_uq on public.coupons (organization_id, lower(code));

alter table public.coupons enable row level security;
drop policy if exists coupons_all on public.coupons;
create policy coupons_all on public.coupons for all
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

alter table public.sales add column if not exists coupon_id uuid references public.coupons(id);

-- ── Validación + cálculo del descuento ───────────────────────
create or replace function public.validate_coupon(p_code text, p_subtotal numeric)
returns table (coupon_id uuid, discount numeric, discount_type text, discount_value numeric, min_amount numeric)
language plpgsql as $$
declare v_org uuid := public.current_org_id(); c record; v_disc numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  select * into c from public.coupons
    where organization_id = v_org and lower(code) = lower(trim(p_code));
  if not found then raise exception 'Cupón inexistente'; end if;
  if not c.active then raise exception 'El cupón está inactivo'; end if;
  if c.expires_at is not null and c.expires_at < current_date then raise exception 'El cupón está vencido'; end if;
  if c.max_uses is not null and c.used_count >= c.max_uses then raise exception 'El cupón alcanzó su límite de usos'; end if;
  if c.min_amount is not null and p_subtotal < c.min_amount then
    raise exception 'La compra no alcanza el mínimo del cupón (%)', c.min_amount;
  end if;

  if c.discount_type = 'percent' then
    v_disc := round(p_subtotal * c.discount_value / 100);
  else
    v_disc := c.discount_value;
  end if;
  if v_disc > p_subtotal then v_disc := p_subtotal; end if;   -- nunca deja el total negativo

  coupon_id := c.id; discount := v_disc;
  discount_type := c.discount_type; discount_value := c.discount_value; min_amount := c.min_amount;
  return next;
end; $$;

-- ── create_sale con cupón (reemplaza el descuento libre) ─────
drop function if exists public.create_sale(uuid, uuid, uuid, uuid, numeric, jsonb, jsonb);
create or replace function public.create_sale(
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_customer_id     uuid,
  p_price_list_id   uuid,
  p_coupon_id       uuid,
  p_items           jsonb,   -- [{ variant_id, product_name, variant_label, quantity, unit_price }]
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
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select warehouse_id into v_wh from public.stores where id = p_store_id and organization_id = v_org;
  if v_wh is null then raise exception 'Local inválido'; end if;

  select coalesce(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) e;

  -- Cupón: validar, calcular descuento e incrementar uso (atómico).
  if p_coupon_id is not null then
    select * into c from public.coupons
      where id = p_coupon_id and organization_id = v_org for update;
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

  insert into public.sales (organization_id, store_id, cash_session_id, customer_id, price_list_id,
                            coupon_id, subtotal, discount, total, created_by)
  values (v_org, p_store_id, p_cash_session_id, p_customer_id, p_price_list_id,
          p_coupon_id, v_subtotal, v_discount, v_total, auth.uid())
  returning id into v_sale;

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

  for v_el in select e from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) as e
  loop
    insert into public.sale_payments (sale_id, payment_method_id, amount, surcharge)
    values (v_sale, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric,
            coalesce((v_el->>'surcharge')::numeric, 0));

    if exists (select 1 from public.payment_methods pm
               where pm.id = (v_el->>'payment_method_id')::uuid and pm.kind = 'cuenta_corriente')
       and p_customer_id is not null then
      update public.customers set balance = balance + (v_el->>'amount')::numeric where id = p_customer_id;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, p_customer_id, (v_el->>'amount')::numeric, 'venta', 'sale', v_sale, auth.uid());
    end if;
  end loop;

  return v_sale;
end; $$;

-- ── cancel_sale: devolver el uso del cupón al anular ─────────
create or replace function public.cancel_sale(p_sale_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_customer uuid; v_coupon uuid; v_it record; v_pay record;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select s.customer_id, s.coupon_id, st.warehouse_id into v_customer, v_coupon, v_wh
  from public.sales s join public.stores st on st.id = s.store_id
  where s.id = p_sale_id and s.organization_id = v_org and s.status = 'completada';
  if not found then raise exception 'Venta no encontrada o ya anulada'; end if;

  for v_it in select variant_id, quantity from public.sale_items where sale_id = p_sale_id
  loop
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, v_wh, v_it.variant_id, v_it.quantity)
    on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + v_it.quantity, updated_at = now();

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_wh, v_it.variant_id, v_it.quantity, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
  end loop;

  if v_customer is not null then
    for v_pay in
      select sp.amount from public.sale_payments sp
      join public.payment_methods pm on pm.id = sp.payment_method_id
      where sp.sale_id = p_sale_id and pm.kind = 'cuenta_corriente'
    loop
      update public.customers set balance = balance - v_pay.amount where id = v_customer;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_customer, -v_pay.amount, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
    end loop;
  end if;

  -- Devolver el uso del cupón.
  if v_coupon is not null then
    update public.coupons set used_count = greatest(used_count - 1, 0) where id = v_coupon;
  end if;

  update public.sales set status = 'anulada' where id = p_sale_id;
end; $$;
