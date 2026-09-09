-- 0096_stock_inicial.sql — carga de STOCK INICIAL por escaneo.
--
-- A diferencia de apply_stock_count (que FIJA el físico al conteo real), acá lo
-- escaneado se SUMA a lo que ya haya en el depósito. Sirve para dar de alta
-- existencias o para ingresos de mercadería: escaneás todo y al aplicar se acumula.
-- Cada variante suma su cantidad (>0); las que no escaneás no se tocan.
-- Deja un movimiento 'stock_inicial' por variante para trazabilidad.
-- Sumar solo aumenta el físico, así que el invariante reserved <= quantity se
-- mantiene sin necesidad de clampear. Append-only e idempotente.

create or replace function public.apply_stock_initial(p_warehouse_id uuid, p_counts jsonb)
returns integer language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_el jsonb; v_variant uuid; v_add integer; n integer := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not (public.has_perm('control_stock', true) or public.has_perm('stock', true)) then
    raise exception 'No tenés permiso para cargar stock inicial';
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and organization_id = v_org) then
    raise exception 'Depósito inválido';
  end if;
  if p_counts is null or jsonb_array_length(p_counts) = 0 then raise exception 'No hay nada para cargar'; end if;

  for v_el in select e from jsonb_array_elements(p_counts) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_add := greatest(0, coalesce((v_el->>'quantity')::integer, 0));
    if v_add = 0 then continue; end if;
    -- La variante tiene que ser de la organización (no confiar en ids del cliente).
    if not exists (select 1 from public.product_variants where id = v_variant and organization_id = v_org) then continue; end if;

    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, p_warehouse_id, v_variant, v_add)
    on conflict (warehouse_id, variant_id) do update
      set quantity = public.stock.quantity + v_add,   -- SUMA a lo existente
          updated_at = now();

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, p_warehouse_id, v_variant, v_add, 'stock_inicial', 'stock_initial', null, auth.uid());
    n := n + 1;
  end loop;

  return n;
end $$;

notify pgrst, 'reload schema';
