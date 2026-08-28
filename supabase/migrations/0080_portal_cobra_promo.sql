-- 0080_portal_cobra_promo.sql — el pedido del portal cobra el PRECIO EFECTIVO.
--
-- portal_create_order arma el pedido en la base y fija el unit_price que se cobra.
-- Antes tomaba siempre el precio de lista; ahora, si el producto tiene promo activa
-- (promo_price no nula y menor al precio de lista), cobra la promo. Así el portal
-- NUNCA muestra un precio y cobra otro: el número que se ve es el que se cobra.
-- Resto del cuerpo idéntico a 0069. Append-only e idempotente.

create or replace function public.portal_create_order(p_customer uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_list uuid; v_store uuid; v_wh uuid; v_sale uuid;
  v_total numeric := 0;
  v_el jsonb; v_variant uuid; v_qty integer; v_pid uuid; v_price numeric; v_promo numeric; v_avail numeric; v_res numeric;
  v_pname text; v_vlabel text;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El pedido está vacío'; end if;

  select c.organization_id, ct.price_list_id
    into v_org, v_list
  from public.customers c
  left join public.customer_types ct on ct.id = c.customer_type_id
  where c.id = p_customer and c.auth_user_id = auth.uid() and c.portal_status = 'aprobado';
  if v_org is null then raise exception 'No autorizado'; end if;
  if v_list is null then raise exception 'Tu cuenta no tiene lista de precios asignada'; end if;

  select st.id, st.warehouse_id into v_store, v_wh
  from public.stores st join public.warehouses w on w.id = st.warehouse_id
  where st.organization_id = v_org and w.name = 'Mayorista - Central'
  order by st.name limit 1;
  if v_store is null then raise exception 'No hay depósito Mayorista-Central configurado'; end if;

  insert into public.sales (organization_id, store_id, customer_id, price_list_id, channel, subtotal, discount, total)
  values (v_org, v_store, p_customer, v_list, 'portal', 0, 0, 0)
  returning id into v_sale;

  for v_el in select e from jsonb_array_elements(p_items) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_qty := (v_el->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then continue; end if;

    select v.product_id, p.name,
           nullif(concat_ws(' / ', nullif(v.size,''), nullif(v.color,'')), '')
      into v_pid, v_pname, v_vlabel
    from public.product_variants v join public.products p on p.id = v.product_id
    where v.id = v_variant and p.organization_id = v_org;
    if v_pid is null then raise exception 'Producto inválido en el pedido'; end if;

    -- Precio EFECTIVO: promo si está activa (no nula y menor al precio de lista).
    select price, promo_price into v_price, v_promo from public.price_list_items
    where price_list_id = v_list and product_id = v_pid and variant_id is null;
    if v_price is null then raise exception 'El producto "%" no tiene precio para tu lista', v_pname; end if;
    if v_promo is not null and v_promo < v_price then v_price := v_promo; end if;

    -- Stock DISPONIBLE en Central (físico − reservado).
    select quantity, reserved into v_avail, v_res from public.stock where warehouse_id = v_wh and variant_id = v_variant for update;
    if coalesce(v_avail,0) - coalesce(v_res,0) < v_qty then
      raise exception 'Stock insuficiente de "%" (disponible %, pediste %)', coalesce(v_vlabel, v_pname), coalesce(v_avail,0) - coalesce(v_res,0), v_qty;
    end if;

    insert into public.sale_items (sale_id, variant_id, product_name, variant_label, quantity, unit_price, line_total)
    values (v_sale, v_variant, v_pname, v_vlabel, v_qty, v_price, v_qty * v_price);

    -- Reserva (el físico queda hasta el despacho).
    update public.stock set reserved = coalesce(reserved,0) + v_qty, updated_at = now()
      where warehouse_id = v_wh and variant_id = v_variant;

    v_total := v_total + v_qty * v_price;
  end loop;

  if v_total <= 0 then raise exception 'El pedido no tiene ítems válidos'; end if;

  update public.sales set subtotal = v_total, total = v_total where id = v_sale;

  update public.customers set balance = balance + v_total where id = p_customer;
  insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id)
  values (v_org, p_customer, v_total, 'venta', 'sale', v_sale);

  return v_sale;
end; $$;
