-- 0053_produccion_reportes_control_caja.sql — Decisiones de producción.
--
-- M2) Reportes: los pedidos IMPAGOS no cuentan. "Ventas"/unidades/medios/top solo
--     consideran ventas con paid_amount >= total (mostrador siempre pago; mayorista
--     cuando se cobró). El neteo de 'cambio' se mantiene.
-- M3) control_sale: el "control por escaneo" se valida en el servidor (lo escaneado
--     debe coincidir exactamente con los ítems del pedido) antes de pasar a controlado.
-- M4) close_cash_session: calcula y GUARDA el efectivo esperado y la diferencia
--     (declarado − esperado), consolidando el efectivo de las cajas de apoyo en la
--     titular. Así toda diferencia queda informada e histórica.
-- Append-only e idempotente.

-- ── M2) Reportes: impagos no cuentan ─────────────────────────────────────────
create or replace function public.report_summary(p_from timestamptz, p_to timestamptz, p_store_id uuid default null)
returns jsonb language plpgsql stable as $$
declare v_ventas numeric; v_cant bigint; v_unid bigint; v_credito numeric;
begin
  select coalesce(sum(total), 0), count(*) into v_ventas, v_cant
  from public.sales
  where organization_id = public.current_org_id() and status = 'completada' and paid_amount >= total - 0.01
    and created_at >= p_from and created_at < p_to
    and (p_store_id is null or store_id = p_store_id);

  select coalesce(sum(sp.amount), 0) into v_credito
  from public.sale_payments sp
  join public.sales s on s.id = sp.sale_id
  join public.payment_methods pm on pm.id = sp.payment_method_id
  where s.organization_id = public.current_org_id() and s.status = 'completada' and s.paid_amount >= s.total - 0.01
    and s.created_at >= p_from and s.created_at < p_to
    and (p_store_id is null or s.store_id = p_store_id)
    and pm.kind = 'cambio';

  select coalesce(sum(si.quantity), 0) into v_unid
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.organization_id = public.current_org_id() and s.status = 'completada' and s.paid_amount >= s.total - 0.01
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
    where sp.sale_id = s.id and pm.kind = 'cambio'
  ) cr on true
  where s.organization_id = public.current_org_id() and s.status = 'completada' and s.paid_amount >= s.total - 0.01
    and s.created_at >= p_from and s.created_at < p_to
    and (p_store_id is null or s.store_id = p_store_id)
  group by st.name order by 2 desc;
$$;

create or replace function public.report_by_method(p_from timestamptz, p_to timestamptz, p_store_id uuid default null)
returns table(metodo text, total numeric) language sql stable as $$
  select pm.name, coalesce(sum(sp.amount), 0)::numeric
  from public.sale_payments sp
  join public.sales s on s.id = sp.sale_id
  join public.payment_methods pm on pm.id = sp.payment_method_id
  where s.organization_id = public.current_org_id() and s.status = 'completada' and s.paid_amount >= s.total - 0.01
    and s.created_at >= p_from and s.created_at < p_to
    and (p_store_id is null or s.store_id = p_store_id)
  group by pm.name order by 2 desc;
$$;

create or replace function public.report_top_products(p_from timestamptz, p_to timestamptz, p_limit integer, p_store_id uuid default null)
returns table(producto text, unidades bigint, total numeric) language sql stable as $$
  select si.product_name, sum(si.quantity)::bigint, sum(si.line_total)::numeric
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.organization_id = public.current_org_id() and s.status = 'completada' and s.paid_amount >= s.total - 0.01
    and s.created_at >= p_from and s.created_at < p_to
    and (p_store_id is null or s.store_id = p_store_id)
  group by si.product_name order by 2 desc limit coalesce(p_limit, 10);
$$;

-- ── M3) control_sale: valida lo escaneado contra el pedido ────────────────────
create or replace function public.control_sale(p_sale_id uuid, p_scanned jsonb)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_it record; v_scanned integer;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  perform 1 from public.sales
    where id = p_sale_id and organization_id = v_org and status = 'completada' and fulfillment_status = 'pendiente'
    for update;
  if not found then raise exception 'El pedido no está pendiente de control'; end if;

  -- Cada ítem debe estar escaneado en la cantidad EXACTA.
  for v_it in select id, quantity from public.sale_items where sale_id = p_sale_id
  loop
    v_scanned := coalesce((p_scanned->>(v_it.id::text))::integer, 0);
    if v_scanned <> v_it.quantity then
      raise exception 'El control no coincide con el pedido (revisá el escaneo).';
    end if;
  end loop;

  update public.sales set fulfillment_status = 'controlado', controlled_at = now(), controlled_by = auth.uid()
    where id = p_sale_id;
end; $$;

-- ── M4) close_cash_session: guarda esperado + diferencia (consolida apoyo) ─────
alter table public.cash_sessions add column if not exists expected_cash   numeric;
alter table public.cash_sessions add column if not exists cash_difference numeric;

create or replace function public.close_cash_session(p_session_id uuid, p_declared_amount numeric, p_kept_amount numeric, p_notes text)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_store uuid; v_role text; v_to_safe numeric;
  v_opening numeric; v_opened_at timestamptz; v_own_cash numeric; v_apoyo_cash numeric := 0;
  v_expected numeric; v_diff numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select store_id, role, opening_amount, opened_at
    into v_store, v_role, v_opening, v_opened_at
  from public.cash_sessions where id = p_session_id and organization_id = v_org and status = 'abierta' for update;
  if not found then raise exception 'Turno no encontrado o ya cerrado'; end if;

  -- Efectivo propio del turno: ventas + cobranzas que afectan caja.
  v_own_cash :=
      coalesce((select sum(sp.amount) from public.sale_payments sp
                join public.sales s on s.id = sp.sale_id
                join public.payment_methods pm on pm.id = sp.payment_method_id
                where s.cash_session_id = p_session_id and s.status = 'completada' and pm.affects_cash), 0)
    + coalesce((select sum(rp.amount) from public.receipt_payments rp
                join public.receipts r on r.id = rp.receipt_id
                join public.payment_methods pm on pm.id = rp.payment_method_id
                where r.cash_session_id = p_session_id and r.status <> 'anulada' and pm.affects_cash), 0);

  if v_role = 'apoyo' then
    v_expected := coalesce(v_opening,0) + v_own_cash;
    v_diff := p_declared_amount - v_expected;
    update public.cash_sessions set status = 'cerrada', declared_amount = p_declared_amount,
      expected_cash = v_expected, cash_difference = v_diff,
      notes = p_notes, closed_by = auth.uid(), closed_at = now() where id = p_session_id;
    return;
  end if;

  if exists (select 1 from public.cash_sessions where store_id = v_store and status = 'abierta' and role = 'apoyo') then
    raise exception 'Cerrá primero las cajas de apoyo del local';
  end if;
  if p_kept_amount < 0 then raise exception 'La caja chica no puede ser negativa'; end if;
  if p_kept_amount > p_declared_amount then raise exception 'La caja chica no puede superar el efectivo contado'; end if;

  -- Titular: sumar el efectivo rendido por sus cajas de apoyo del turno.
  select coalesce(sum(x.c), 0) into v_apoyo_cash from (
    select coalesce((select sum(sp.amount) from public.sale_payments sp
                     join public.sales s2 on s2.id = sp.sale_id
                     join public.payment_methods pm on pm.id = sp.payment_method_id
                     where s2.cash_session_id = ap.id and s2.status = 'completada' and pm.affects_cash), 0)
         + coalesce((select sum(rp.amount) from public.receipt_payments rp
                     join public.receipts r on r.id = rp.receipt_id
                     join public.payment_methods pm on pm.id = rp.payment_method_id
                     where r.cash_session_id = ap.id and r.status <> 'anulada' and pm.affects_cash), 0) as c
    from public.cash_sessions ap
    where ap.store_id = v_store and ap.role = 'apoyo' and ap.opened_at >= v_opened_at
  ) x;

  v_expected := coalesce(v_opening,0) + v_own_cash + v_apoyo_cash;
  v_diff := p_declared_amount - v_expected;

  perform 1 from public.store_petty where store_id = v_store for update;
  perform 1 from public.store_safe where store_id = v_store for update;

  v_to_safe := p_declared_amount - p_kept_amount;
  update public.cash_sessions set status = 'cerrada', declared_amount = p_declared_amount,
    kept_amount = p_kept_amount, to_safe_amount = v_to_safe,
    expected_cash = v_expected, cash_difference = v_diff,
    notes = p_notes, closed_by = auth.uid(), closed_at = now() where id = p_session_id;

  insert into public.store_petty (organization_id, store_id, balance)
  values (v_org, v_store, p_kept_amount)
  on conflict (store_id) do update set balance = p_kept_amount, updated_at = now();

  if v_to_safe <> 0 then
    insert into public.store_safe (organization_id, store_id, balance)
    values (v_org, v_store, v_to_safe)
    on conflict (store_id) do update set balance = public.store_safe.balance + v_to_safe, updated_at = now();
  end if;
end; $$;
