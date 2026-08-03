-- 0013_reportes.sql — Funciones de reporte de ventas (agregaciones).
-- Todas filtran por la org actual, ventas completadas, y el rango de fechas.
-- Append-only e idempotente.

create or replace function public.report_summary(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable as $$
declare v_ventas numeric; v_cant bigint; v_unid bigint;
begin
  select coalesce(sum(total), 0), count(*) into v_ventas, v_cant
  from public.sales
  where organization_id = public.current_org_id() and status = 'completada'
    and created_at >= p_from and created_at < p_to;

  select coalesce(sum(si.quantity), 0) into v_unid
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.organization_id = public.current_org_id() and s.status = 'completada'
    and s.created_at >= p_from and s.created_at < p_to;

  return jsonb_build_object('ventas', v_ventas, 'cantidad', v_cant, 'unidades', v_unid);
end; $$;

create or replace function public.report_by_store(p_from timestamptz, p_to timestamptz)
returns table(store text, ventas numeric, cantidad bigint) language sql stable as $$
  select st.name, coalesce(sum(s.total), 0)::numeric, count(*)::bigint
  from public.sales s join public.stores st on st.id = s.store_id
  where s.organization_id = public.current_org_id() and s.status = 'completada'
    and s.created_at >= p_from and s.created_at < p_to
  group by st.name order by 2 desc;
$$;

create or replace function public.report_by_method(p_from timestamptz, p_to timestamptz)
returns table(metodo text, total numeric) language sql stable as $$
  select pm.name, coalesce(sum(sp.amount), 0)::numeric
  from public.sale_payments sp
  join public.sales s on s.id = sp.sale_id
  join public.payment_methods pm on pm.id = sp.payment_method_id
  where s.organization_id = public.current_org_id() and s.status = 'completada'
    and s.created_at >= p_from and s.created_at < p_to
  group by pm.name order by 2 desc;
$$;

create or replace function public.report_top_products(p_from timestamptz, p_to timestamptz, p_limit integer)
returns table(producto text, unidades bigint, total numeric) language sql stable as $$
  select si.product_name, sum(si.quantity)::bigint, sum(si.line_total)::numeric
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.organization_id = public.current_org_id() and s.status = 'completada'
    and s.created_at >= p_from and s.created_at < p_to
  group by si.product_name order by 2 desc limit coalesce(p_limit, 10);
$$;
