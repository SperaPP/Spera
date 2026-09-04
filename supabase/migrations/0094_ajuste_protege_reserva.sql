-- 0094_ajuste_protege_reserva.sql — el ajuste manual de stock no puede dejar el
-- físico por debajo de lo ya reservado en pedidos sin despachar.
--
-- Antes: adjust_stock hacía `reserved = least(reserved, nuevo)`, así que bajar el
-- físico a 0 borraba en silencio la reserva de un pedido ya armado/controlado y le
-- sacaba la prenda de abajo (caso real: pedido que quedó "sin stock físico para
-- despachar" tras un ajuste a 0). Ahora, si intentás dejar el físico por debajo de
-- lo reservado, la función FRENA con un mensaje claro; el operador tiene que
-- despachar/cancelar/editar esos pedidos primero. Invariante: quantity >= reserved.
--
-- Append-only e idempotente (recrea la función). Firma y resto idénticos a 0064.

create or replace function public.adjust_stock(
  p_warehouse_id uuid,
  p_variant_id   uuid,
  p_new_quantity integer,
  p_reason       text
) returns integer language plpgsql as $$
declare
  v_org      uuid := public.current_org_id();
  v_current  integer;
  v_reserved integer;
  v_delta    integer;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not (public.has_perm('control_stock', true) or public.has_perm('stock', true)) then
    raise exception 'No tenés permiso para ajustar stock';
  end if;
  if p_new_quantity < 0 then raise exception 'La cantidad no puede ser negativa'; end if;

  select quantity, coalesce(reserved, 0) into v_current, v_reserved
  from public.stock where warehouse_id = p_warehouse_id and variant_id = p_variant_id for update;
  v_current  := coalesce(v_current, 0);
  v_reserved := coalesce(v_reserved, 0);
  v_delta    := p_new_quantity - v_current;

  -- Protección de reservas: no dejar el físico por debajo de lo reservado.
  if p_new_quantity < v_reserved then
    raise exception 'No podés dejar el físico en %: hay % unidad(es) reservada(s) en pedidos sin despachar. Despachá, cancelá o editá esos pedidos primero, o ajustá a % o más.',
      p_new_quantity, v_reserved, v_reserved;
  end if;

  if v_delta = 0 then return p_new_quantity; end if;

  insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
  values (v_org, p_warehouse_id, p_variant_id, p_new_quantity)
  on conflict (warehouse_id, variant_id) do update
    set quantity = p_new_quantity,   -- la reserva ya no se toca: quedó protegida arriba
        updated_at = now();

  insert into public.stock_movements
    (organization_id, warehouse_id, variant_id, delta, reason, reference_type, created_by)
  values (v_org, p_warehouse_id, p_variant_id, v_delta, coalesce(nullif(p_reason,''),'ajuste'), 'stock_adjust', auth.uid());

  return p_new_quantity;
end; $$;

notify pgrst, 'reload schema';
