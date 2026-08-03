-- 0007_pos_caja.sql — POS y caja: medios de pago, turnos de caja, ventas,
-- ítems, cobros, y funciones atómicas. Append-only e idempotente.

-- ── Medios de pago ───────────────────────────────────────────
create table if not exists public.payment_methods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  kind            text not null default 'otro'
    check (kind in ('efectivo','tarjeta','transferencia','digital','cuenta_corriente','otro')),
  surcharge_pct   numeric(6,3) not null default 0,  -- recargo (ej. cuotas) — se afina después
  affects_cash    boolean not null default false,   -- true = suma al arqueo de efectivo del turno
  active          boolean not null default true,
  position        integer not null default 0,
  unique (organization_id, name)
);

-- ── Turnos de caja ───────────────────────────────────────────
create table if not exists public.cash_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  store_id        uuid not null references public.stores(id),
  status          text not null default 'abierta' check (status in ('abierta','cerrada')),
  opening_amount  numeric(14,2) not null default 0,
  opened_by       uuid references auth.users(id),
  opened_at       timestamptz not null default now(),
  declared_amount numeric(14,2),      -- efectivo contado al cerrar (cierre abierto)
  closed_by       uuid references auth.users(id),
  closed_at       timestamptz,
  notes           text
);
-- Un solo turno abierto por local a la vez.
create unique index if not exists cash_sessions_one_open
  on public.cash_sessions (store_id) where status = 'abierta';

-- ── Ventas ───────────────────────────────────────────────────
create sequence if not exists public.sale_number_seq start 1;

create table if not exists public.sales (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number          bigint not null default nextval('public.sale_number_seq'),
  store_id        uuid not null references public.stores(id),
  cash_session_id uuid references public.cash_sessions(id),
  customer_id     uuid references public.customers(id),
  price_list_id   uuid references public.price_lists(id),
  channel         text not null default 'pos',
  status          text not null default 'completada' check (status in ('completada','anulada')),
  subtotal        numeric(14,2) not null default 0,
  discount        numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists sales_session_idx on public.sales (cash_session_id);
create index if not exists sales_customer_idx on public.sales (customer_id, created_at desc);
create index if not exists sales_created_idx on public.sales (organization_id, created_at desc);

create table if not exists public.sale_items (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references public.sales(id) on delete cascade,
  variant_id    uuid references public.product_variants(id),
  product_name  text not null,      -- snapshot para el ticket
  variant_label text,               -- ej. "M / Negro"
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(14,2) not null,
  line_total    numeric(14,2) not null
);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);

create table if not exists public.sale_payments (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales(id) on delete cascade,
  payment_method_id uuid not null references public.payment_methods(id),
  amount            numeric(14,2) not null,
  surcharge         numeric(14,2) not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists sale_payments_sale_idx on public.sale_payments (sale_id);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.payment_methods enable row level security;
alter table public.cash_sessions   enable row level security;
alter table public.sales           enable row level security;
alter table public.sale_items      enable row level security;
alter table public.sale_payments   enable row level security;

drop policy if exists payment_methods_all on public.payment_methods;
create policy payment_methods_all on public.payment_methods for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());

drop policy if exists cash_sessions_all on public.cash_sessions;
create policy cash_sessions_all on public.cash_sessions for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());

drop policy if exists sales_all on public.sales;
create policy sales_all on public.sales for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());

-- ítems y cobros se acotan vía la venta padre
drop policy if exists sale_items_all on public.sale_items;
create policy sale_items_all on public.sale_items for all
  using (exists (select 1 from public.sales s where s.id = sale_id and s.organization_id = public.current_org_id()))
  with check (exists (select 1 from public.sales s where s.id = sale_id and s.organization_id = public.current_org_id()));

drop policy if exists sale_payments_all on public.sale_payments;
create policy sale_payments_all on public.sale_payments for all
  using (exists (select 1 from public.sales s where s.id = sale_id and s.organization_id = public.current_org_id()))
  with check (exists (select 1 from public.sales s where s.id = sale_id and s.organization_id = public.current_org_id()));

-- ── Semilla de medios de pago ────────────────────────────────
insert into public.payment_methods (organization_id, name, kind, affects_cash, position)
select o.id, m.name, m.kind, m.cash, m.pos
from public.organizations o
join (values
  ('Efectivo',         'efectivo',         true,  1),
  ('Débito',           'tarjeta',          false, 2),
  ('Crédito',          'tarjeta',          false, 3),
  ('Transferencia',    'transferencia',    false, 4),
  ('MercadoPago',      'digital',          false, 5),
  ('Cuenta corriente', 'cuenta_corriente', false, 6)
) as m(name, kind, cash, pos) on true
where o.name = 'Bodysculpt'
on conflict (organization_id, name) do nothing;

-- ── RPC: abrir turno de caja ─────────────────────────────────
create or replace function public.open_cash_session(p_store_id uuid, p_opening_amount numeric)
returns uuid language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_id uuid;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if exists (select 1 from public.cash_sessions where store_id = p_store_id and status = 'abierta') then
    raise exception 'Ya hay un turno de caja abierto en este local';
  end if;
  insert into public.cash_sessions (organization_id, store_id, opening_amount, opened_by)
  values (v_org, p_store_id, coalesce(p_opening_amount,0), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- ── RPC: cerrar turno de caja ────────────────────────────────
create or replace function public.close_cash_session(p_session_id uuid, p_declared_amount numeric, p_notes text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  update public.cash_sessions
     set status = 'cerrada', declared_amount = p_declared_amount, notes = p_notes,
         closed_by = auth.uid(), closed_at = now()
   where id = p_session_id and organization_id = v_org and status = 'abierta';
  if not found then raise exception 'Turno no encontrado o ya cerrado'; end if;
end; $$;

-- ── RPC: crear venta (atómica) ───────────────────────────────
-- Descuenta stock del depósito del local, registra cobros, y manda a
-- cuenta corriente lo cobrado con el medio 'cuenta_corriente'.
create or replace function public.create_sale(
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_customer_id     uuid,
  p_price_list_id   uuid,
  p_discount        numeric,
  p_items           jsonb,   -- [{ variant_id, product_name, variant_label, quantity, unit_price }]
  p_payments        jsonb    -- [{ payment_method_id, amount, surcharge }]
) returns uuid language plpgsql as $$
declare
  v_org      uuid := public.current_org_id();
  v_wh       uuid;
  v_sale     uuid;
  v_subtotal numeric := 0;
  v_total    numeric := 0;
  v_el       jsonb;
  v_qty      integer;
  v_variant  uuid;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select warehouse_id into v_wh from public.stores where id = p_store_id and organization_id = v_org;
  if v_wh is null then raise exception 'Local inválido'; end if;

  select coalesce(sum((e->>'quantity')::numeric * (e->>'unit_price')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) e;
  v_total := v_subtotal - coalesce(p_discount, 0);

  insert into public.sales (organization_id, store_id, cash_session_id, customer_id, price_list_id,
                            subtotal, discount, total, created_by)
  values (v_org, p_store_id, p_cash_session_id, p_customer_id, p_price_list_id,
          v_subtotal, coalesce(p_discount,0), v_total, auth.uid())
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

    -- Cuenta corriente: suma deuda al cliente
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
