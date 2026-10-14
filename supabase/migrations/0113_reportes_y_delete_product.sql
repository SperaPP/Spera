-- 0113_reportes_y_delete_product.sql — auditoría de sistema #M3, #B1, #B3.
--
-- #M3 report_by_method sumaba el medio interno "Cambio" (crédito por mercadería
--     devuelta) como plata cobrada → la fila "Cambio" mostraba dinero que nunca entró
--     a caja y el total de medios no cuadraba con el tile "Ventas" (que sí lo netea).
--     Ahora se excluye el medio 'cambio' del mix de cobro.
-- #B1 "Cantidad de ventas" y el ticket promedio contaban las operaciones de cambio
--     (channel 'cambio') como ventas. Ahora el CONTEO las excluye (la facturación neta
--     no cambia: el total ya se netea por el crédito de cambio). Los pedidos de portal
--     SÍ cuentan (son ventas reales).
-- #B3 delete_product solo miraba ventas/transferencias; un producto con solo
--     movimientos de stock (ajuste/conteo/stock_inicial/devolución) se podía borrar y
--     se perdía ese rastro. Ahora también bloquea si tiene stock_movements (hay que
--     desactivarlo), preservando la auditoría.
-- Append-only e idempotente.

-- ── #B1: el conteo de ventas excluye los cambios (la facturación no cambia) ──
create or replace function public.report_summary(p_from timestamptz, p_to timestamptz, p_store_id uuid default null)
returns jsonb language plpgsql stable as $$
declare v_ventas numeric; v_cant bigint; v_unid bigint; v_credito numeric;
begin
  select coalesce(sum(total), 0),
         count(*) filter (where coalesce(channel, '') <> 'cambio')
    into v_ventas, v_cant
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
         count(*) filter (where coalesce(s.channel, '') <> 'cambio')::bigint
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

-- ── #M3: el mix de cobro excluye el medio interno "Cambio" ──
create or replace function public.report_by_method(p_from timestamptz, p_to timestamptz, p_store_id uuid default null)
returns table(metodo text, total numeric) language sql stable as $$
  select pm.name, coalesce(sum(sp.amount), 0)::numeric
  from public.sale_payments sp
  join public.sales s on s.id = sp.sale_id
  join public.payment_methods pm on pm.id = sp.payment_method_id
  where s.organization_id = public.current_org_id() and s.status = 'completada' and s.paid_amount >= s.total - 0.01
    and s.created_at >= p_from and s.created_at < p_to
    and (p_store_id is null or s.store_id = p_store_id)
    and coalesce(pm.kind, '') <> 'cambio'
  group by pm.name order by 2 desc;
$$;

-- ── #B3: delete_product preserva el historial de movimientos ──
create or replace function public.delete_product(p_product_id uuid) returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not public.has_perm('productos', true) then raise exception 'No tenés permiso para eliminar productos'; end if;
  if not exists (select 1 from public.products where id = p_product_id and organization_id = v_org) then
    raise exception 'Producto inválido';
  end if;

  if exists (select 1 from public.sale_items si join public.product_variants v on v.id = si.variant_id where v.product_id = p_product_id)
     or exists (select 1 from public.stock_transfer_items ti join public.product_variants v on v.id = ti.variant_id where v.product_id = p_product_id)
     or exists (select 1 from public.stock_movements sm join public.product_variants v on v.id = sm.variant_id where v.product_id = p_product_id) then
    raise exception 'El producto tiene movimientos (ventas, transferencias o ajustes de stock). Desactivalo en lugar de eliminarlo.';
  end if;

  -- Borrar el producto: la cascada elimina variantes, stock, precios, fotos y mapeos.
  delete from public.products where id = p_product_id and organization_id = v_org;
end $$;

notify pgrst, 'reload schema';
