-- 0082_cobros_unificados.sql — listado paginado de TODO el dinero que ingresa.
--
-- Une las cobranzas (receipts) con la parte cobrada en dinero real de las ventas
-- (sale_payments cuyo medio NO es cuenta corriente / saldo a favor / cambio), de
-- todos los canales. Ordena por fecha desc y pagina con limit/offset. Devuelve
-- también el total de registros y el monto total ingresado (para el pie y la
-- paginación). SECURITY INVOKER: respeta RLS por organización.
-- Append-only e idempotente.

create or replace function public.cobros_list(p_limit int, p_offset int)
returns table(
  kind text, id uuid, number bigint, created_at timestamptz, monto numeric,
  anulada boolean, channel text, cliente text, total_count bigint, total_monto numeric
) language sql stable as $$
  with unified as (
    -- Cobranzas: todo el receipt es dinero real.
    select 'cobranza'::text as kind, r.id, r.number::bigint as number, r.created_at,
           r.total as monto, (r.status = 'anulada') as anulada, null::text as channel,
           coalesce((select c.name from public.customers c where c.id = r.customer_id), '—') as cliente
    from public.receipts r
    where r.organization_id = public.current_org_id()
    union all
    -- Ventas: parte cobrada en dinero real (excluye cta cte / saldo a favor / cambio).
    select 'venta'::text, s.id, s.number::bigint, s.created_at,
           (select coalesce(sum(sp.amount), 0) from public.sale_payments sp
              join public.payment_methods pm on pm.id = sp.payment_method_id
              where sp.sale_id = s.id and pm.kind not in ('cuenta_corriente','saldo_favor','cambio')) as monto,
           false, s.channel,
           coalesce((select c.name from public.customers c where c.id = s.customer_id), s.customer_name, 'Consumidor final') as cliente
    from public.sales s
    where s.organization_id = public.current_org_id() and s.status <> 'anulada'
      and exists (
        select 1 from public.sale_payments sp
        join public.payment_methods pm on pm.id = sp.payment_method_id
        where sp.sale_id = s.id and pm.kind not in ('cuenta_corriente','saldo_favor','cambio')
      )
  )
  select kind, id, number, created_at, monto, anulada, channel, cliente,
         count(*) over() as total_count,
         coalesce(sum(monto) filter (where not anulada) over(), 0) as total_monto
  from unified
  order by created_at desc
  limit greatest(1, p_limit) offset greatest(0, p_offset);
$$;
