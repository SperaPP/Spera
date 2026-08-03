-- 0014_anular_venta.sql — Anular una venta: repone stock, revierte la deuda de
-- cuenta corriente y marca la venta como anulada. Append-only e idempotente.
-- (Las ventas anuladas ya quedan fuera del arqueo de caja y de los reportes,
--  porque esos filtran por status = 'completada'.)

create or replace function public.cancel_sale(p_sale_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_customer uuid; v_it record; v_pay record;
begin
  if v_org is null then raise exception 'Sin organización'; end if;

  select s.customer_id, st.warehouse_id into v_customer, v_wh
  from public.sales s join public.stores st on st.id = s.store_id
  where s.id = p_sale_id and s.organization_id = v_org and s.status = 'completada';
  if not found then raise exception 'Venta no encontrada o ya anulada'; end if;

  -- Reponer stock al depósito del local.
  for v_it in select variant_id, quantity from public.sale_items where sale_id = p_sale_id
  loop
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, v_wh, v_it.variant_id, v_it.quantity)
    on conflict (warehouse_id, variant_id) do update set quantity = stock.quantity + v_it.quantity, updated_at = now();

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, v_wh, v_it.variant_id, v_it.quantity, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
  end loop;

  -- Revertir la deuda de cuenta corriente (lo cobrado con ese medio sumó deuda).
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

  update public.sales set status = 'anulada' where id = p_sale_id;
end; $$;
