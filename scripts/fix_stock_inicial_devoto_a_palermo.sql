-- fix_stock_inicial_devoto_a_palermo.sql — corrección de datos (one-off).
--
-- El 2026-09-09 14:21:28.041551+00, massao@hotmail.es cargó "stock inicial" (116 u
-- en 115 variantes) al depósito EQUIVOCADO: fue a Devoto y correspondía a Palermo.
-- Este script mueve exactamente ese lote de Devoto -> Palermo (resta en Devoto,
-- suma en Palermo, usando el delta real de cada movimiento) y deja movimientos de
-- auditoría 'correccion_stock_inicial'.
--
-- Es atómico (todo o nada), respeta lo reservado (no deja físico < reservado) e
-- IDEMPOTENTE: si ya se corrigió, no hace nada. Correr UNA vez en el SQL Editor.

do $$
declare
  v_batch    timestamptz := '2026-09-09 14:21:28.041551+00';
  v_devoto   uuid;
  v_palermo  uuid;
  r          record;
  v_qty      integer;
  v_res      integer;
  n          integer := 0;
  total      integer := 0;
begin
  select id into v_devoto  from public.warehouses where name ilike '%devoto%'  limit 1;
  select id into v_palermo from public.warehouses where name ilike '%palermo%' limit 1;
  if v_devoto is null or v_palermo is null then
    raise exception 'No encontré los depósitos Devoto/Palermo';
  end if;

  -- ¿Ya se corrigió este lote? (evita doble corrección)
  if exists (
    select 1 from public.stock_movements c
    where c.reason = 'correccion_stock_inicial'
      and c.reference_id in (
        select sm.id from public.stock_movements sm
        where sm.warehouse_id = v_devoto and sm.reason = 'stock_inicial' and sm.created_at = v_batch
      )
  ) then
    raise notice 'El lote ya estaba corregido. No se hace nada.';
    return;
  end if;

  for r in
    select sm.id as mov_id, sm.variant_id, sm.delta, sm.organization_id
    from public.stock_movements sm
    where sm.warehouse_id = v_devoto and sm.reason = 'stock_inicial' and sm.created_at = v_batch
  loop
    -- ── Devoto: restar el delta (sin bajar de lo reservado) ──
    select quantity, coalesce(reserved, 0) into v_qty, v_res
      from public.stock where warehouse_id = v_devoto and variant_id = r.variant_id for update;
    if v_qty is null or v_qty - r.delta < v_res then
      raise exception 'No puedo restar % u. de la variante % en Devoto (físico %, reservado %). Abortado, no se tocó nada.',
        r.delta, r.variant_id, coalesce(v_qty, 0), coalesce(v_res, 0);
    end if;
    update public.stock set quantity = quantity - r.delta, updated_at = now()
      where warehouse_id = v_devoto and variant_id = r.variant_id;
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (r.organization_id, v_devoto, r.variant_id, -r.delta, 'correccion_stock_inicial', 'stock_movement', r.mov_id, null);

    -- ── Palermo: sumar el delta ──
    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (r.organization_id, v_palermo, r.variant_id, r.delta)
    on conflict (warehouse_id, variant_id) do update set quantity = public.stock.quantity + r.delta, updated_at = now();
    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (r.organization_id, v_palermo, r.variant_id, r.delta, 'correccion_stock_inicial', 'stock_movement', r.mov_id, null);

    n := n + 1;
    total := total + r.delta;
  end loop;

  raise notice 'Corrección aplicada: % variante(s), % unidad(es) movidas de Devoto a Palermo.', n, total;
end $$;
