-- 0052_fixes_auditoria_2.sql — Refinamientos de la 2ª auditoría.
--
-- 1) Reportes: netean SOLO el crédito de 'cambio' (no 'saldo_favor'). El saldo a
--    favor puede originarse en un SOBREPAGO (dinero real nunca contado como venta);
--    netearlo sub-reportaba ventas. Además queda alineado con las vistas de caja,
--    que ya netean solo 'cambio'. El fiado (cuenta_corriente) sigue contando como venta.
-- 2) cancel_receipt: no se puede anular una cobranza que pagó un pedido ya
--    despachado (dejaría un pedido despachado con paid_amount < total, violando el
--    candado de pago de forma retroactiva; la mercadería ya salió).
-- Append-only e idempotente.

-- ── 1) Reportes: netear solo 'cambio' ────────────────────────────────────────
create or replace function public.report_summary(p_from timestamptz, p_to timestamptz, p_store_id uuid default null)
returns jsonb language plpgsql stable as $$
declare v_ventas numeric; v_cant bigint; v_unid bigint; v_credito numeric;
begin
  select coalesce(sum(total), 0), count(*) into v_ventas, v_cant
  from public.sales
  where organization_id = public.current_org_id() and status = 'completada'
    and created_at >= p_from and created_at < p_to
    and (p_store_id is null or store_id = p_store_id);

  -- Crédito reusado del cambio (ya contado en la venta original). NO se netea
  -- saldo_favor (puede ser un sobrepago, que es dinero real no contado como venta).
  select coalesce(sum(sp.amount), 0) into v_credito
  from public.sale_payments sp
  join public.sales s on s.id = sp.sale_id
  join public.payment_methods pm on pm.id = sp.payment_method_id
  where s.organization_id = public.current_org_id() and s.status = 'completada'
    and s.created_at >= p_from and s.created_at < p_to
    and (p_store_id is null or s.store_id = p_store_id)
    and pm.kind = 'cambio';

  select coalesce(sum(si.quantity), 0) into v_unid
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.organization_id = public.current_org_id() and s.status = 'completada'
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
  where s.organization_id = public.current_org_id() and s.status = 'completada'
    and s.created_at >= p_from and s.created_at < p_to
    and (p_store_id is null or s.store_id = p_store_id)
  group by st.name order by 2 desc;
$$;

-- ── 2) cancel_receipt: no anular cobranza de un pedido ya despachado ──────────
create or replace function public.cancel_receipt(p_receipt_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id(); v_customer uuid; v_total numeric; v_al record;
begin
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
