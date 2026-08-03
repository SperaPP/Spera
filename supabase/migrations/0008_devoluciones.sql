-- 0008_devoluciones.sql — Devoluciones: pantalla aparte, pendiente → aprobada.
-- Al aprobar: reingresa stock + suma saldo a favor en cuenta corriente.
-- Regla de negocio: solo se puede devolver una variante que el cliente compró
-- en los últimos 30 días. Append-only e idempotente.

create sequence if not exists public.return_number_seq start 1;

create table if not exists public.returns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number          bigint not null default nextval('public.return_number_seq'),
  customer_id     uuid not null references public.customers(id),
  store_id        uuid not null references public.stores(id),
  status          text not null default 'pendiente' check (status in ('pendiente','aprobada','rechazada')),
  total           numeric(14,2) not null default 0,
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz
);
create index if not exists returns_status_idx on public.returns (organization_id, status, created_at desc);

create table if not exists public.return_items (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references public.returns(id) on delete cascade,
  variant_id    uuid not null references public.product_variants(id),
  product_name  text not null,
  variant_label text,
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(14,2) not null,
  line_total    numeric(14,2) not null
);
create index if not exists return_items_return_idx on public.return_items (return_id);

alter table public.returns      enable row level security;
alter table public.return_items enable row level security;

drop policy if exists returns_all on public.returns;
create policy returns_all on public.returns for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());

drop policy if exists return_items_all on public.return_items;
create policy return_items_all on public.return_items for all
  using (exists (select 1 from public.returns r where r.id = return_id and r.organization_id = public.current_org_id()))
  with check (exists (select 1 from public.returns r where r.id = return_id and r.organization_id = public.current_org_id()));

-- ── Elegibilidad: ¿el cliente compró esta variante en los últimos 30 días? ──
create or replace function public.check_return_eligibility(p_customer uuid, p_variant uuid)
returns jsonb language plpgsql stable as $$
declare v_price numeric; v_date timestamptz;
begin
  select si.unit_price, s.created_at into v_price, v_date
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.organization_id = public.current_org_id()
    and s.customer_id = p_customer and si.variant_id = p_variant
    and s.status = 'completada'
    and s.created_at >= now() - interval '30 days'
  order by s.created_at desc limit 1;

  if v_price is null then return jsonb_build_object('eligible', false); end if;
  return jsonb_build_object('eligible', true, 'unit_price', v_price, 'last_date', v_date);
end; $$;

-- ── Crear devolución (queda pendiente; NO toca stock ni cuenta corriente) ──
create or replace function public.create_return(p_customer uuid, p_store_id uuid, p_items jsonb, p_notes text)
returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_ret uuid; v_el jsonb; v_price numeric; v_qty integer; v_variant uuid; v_total numeric := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La devolución no tiene ítems'; end if;

  insert into public.returns (organization_id, customer_id, store_id, notes, created_by)
  values (v_org, p_customer, p_store_id, nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  returning id into v_ret;

  for v_el in select e from jsonb_array_elements(p_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;

    -- Revalida la regla de 30 días y toma el precio de la última compra.
    select si.unit_price into v_price
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where s.organization_id = v_org and s.customer_id = p_customer and si.variant_id = v_variant
      and s.status = 'completada' and s.created_at >= now() - interval '30 days'
    order by s.created_at desc limit 1;

    if v_price is null then
      raise exception 'La variante % no fue comprada por el cliente en los últimos 30 días', v_el->>'product_name';
    end if;

    insert into public.return_items (return_id, variant_id, product_name, variant_label, quantity, unit_price, line_total)
    values (v_ret, v_variant, v_el->>'product_name', nullif(v_el->>'variant_label',''), v_qty, v_price, v_qty * v_price);
    v_total := v_total + v_qty * v_price;
  end loop;

  update public.returns set total = v_total where id = v_ret;
  return v_ret;
end; $$;

-- ── Aprobar devolución: reingresa stock + suma saldo a favor ──
create or replace function public.approve_return(p_return_id uuid)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_wh uuid; v_customer uuid; v_total numeric; v_it record;
begin
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

-- ── Rechazar devolución (no toca nada) ──
create or replace function public.reject_return(p_return_id uuid)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  update public.returns set status = 'rechazada', approved_by = auth.uid(), approved_at = now()
  where id = p_return_id and organization_id = v_org and status = 'pendiente';
  if not found then raise exception 'Devolución no encontrada o ya procesada'; end if;
end; $$;
