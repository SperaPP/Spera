-- 0009_cobranzas.sql — Cobranzas: recibir pagos a cuenta corriente de clientes.
-- Reduce el saldo del cliente y (si se cobra en efectivo con una caja abierta)
-- entra al arqueo de ese turno. Append-only e idempotente.

create sequence if not exists public.receipt_number_seq start 1;

create table if not exists public.receipts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  number          bigint not null default nextval('public.receipt_number_seq'),
  customer_id     uuid not null references public.customers(id),
  store_id        uuid references public.stores(id),
  cash_session_id uuid references public.cash_sessions(id),
  total           numeric(14,2) not null default 0,
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists receipts_customer_idx on public.receipts (customer_id, created_at desc);
create index if not exists receipts_session_idx on public.receipts (cash_session_id);

create table if not exists public.receipt_payments (
  id                uuid primary key default gen_random_uuid(),
  receipt_id        uuid not null references public.receipts(id) on delete cascade,
  payment_method_id uuid not null references public.payment_methods(id),
  amount            numeric(14,2) not null
);
create index if not exists receipt_payments_receipt_idx on public.receipt_payments (receipt_id);

alter table public.receipts         enable row level security;
alter table public.receipt_payments enable row level security;

drop policy if exists receipts_all on public.receipts;
create policy receipts_all on public.receipts for all
  using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id());

drop policy if exists receipt_payments_all on public.receipt_payments;
create policy receipt_payments_all on public.receipt_payments for all
  using (exists (select 1 from public.receipts r where r.id = receipt_id and r.organization_id = public.current_org_id()))
  with check (exists (select 1 from public.receipts r where r.id = receipt_id and r.organization_id = public.current_org_id()));

-- ── Crear cobranza (atómica): baja la deuda del cliente ──
create or replace function public.create_receipt(
  p_customer        uuid,
  p_store_id        uuid,
  p_cash_session_id uuid,
  p_payments        jsonb,   -- [{ payment_method_id, amount }]
  p_notes           text
) returns uuid language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_receipt uuid; v_total numeric := 0; v_el jsonb;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_payments is null or jsonb_array_length(p_payments) = 0 then raise exception 'La cobranza no tiene medios de pago'; end if;

  select coalesce(sum((e->>'amount')::numeric), 0) into v_total
  from jsonb_array_elements(p_payments) e;
  if v_total <= 0 then raise exception 'El monto a cobrar debe ser mayor a cero'; end if;

  insert into public.receipts (organization_id, customer_id, store_id, cash_session_id, total, notes, created_by)
  values (v_org, p_customer, p_store_id, p_cash_session_id, v_total, nullif(trim(coalesce(p_notes,'')),''), auth.uid())
  returning id into v_receipt;

  for v_el in select e from jsonb_array_elements(p_payments) as e
  loop
    insert into public.receipt_payments (receipt_id, payment_method_id, amount)
    values (v_receipt, (v_el->>'payment_method_id')::uuid, (v_el->>'amount')::numeric);
  end loop;

  update public.customers set balance = balance - v_total where id = p_customer;
  insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
  values (v_org, p_customer, -v_total, 'cobranza', 'receipt', v_receipt, auth.uid());

  return v_receipt;
end; $$;
