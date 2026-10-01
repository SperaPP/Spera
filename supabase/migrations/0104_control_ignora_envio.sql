-- 0104_control_ignora_envio.sql — el control por escaneo ignora ítems sin variante.
--
-- Los pedidos de Tiendanube pueden traer líneas sin variante (el "Envío", o un
-- producto web que no matcheó un SKU). Esas líneas no tienen código para escanear,
-- así que control_sale (que exigía escanear TODOS los ítems en la cantidad exacta)
-- dejaba el pedido imposible de confirmar. Ahora solo exige el escaneo de los ítems
-- con variante (las prendas reales); las líneas sin variante se ignoran en el control.
-- Append-only e idempotente.

create or replace function public.control_sale(p_sale_id uuid, p_scanned jsonb)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_it record; v_scanned integer;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  perform 1 from public.sales
    where id = p_sale_id and organization_id = v_org and status = 'completada' and fulfillment_status = 'pendiente'
    for update;
  if not found then raise exception 'El pedido no está pendiente de control'; end if;

  -- Solo las prendas reales (con variante) deben escanearse en la cantidad exacta.
  -- Las líneas sin variante (envío, producto web sin matchear) no se escanean.
  for v_it in select id, quantity from public.sale_items where sale_id = p_sale_id and variant_id is not null
  loop
    v_scanned := coalesce((p_scanned->>(v_it.id::text))::integer, 0);
    if v_scanned <> v_it.quantity then
      raise exception 'El control no coincide con el pedido (revisá el escaneo).';
    end if;
  end loop;

  update public.sales set fulfillment_status = 'controlado', controlled_at = now(), controlled_by = auth.uid()
    where id = p_sale_id;
end; $$;

notify pgrst, 'reload schema';
