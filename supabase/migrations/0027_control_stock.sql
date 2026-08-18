-- 0027_control_stock.sql — Control de stock por conteo (escaneo) de una sucursal.
--  Se escanean/seleccionan productos; para cada variante en alcance, el stock del
--  sistema queda igual al conteo real (las no contadas de un producto en alcance → 0).
--  Permiso propio 'control_stock' (para el futuro perfil Supervisor). Append-only.

-- Permiso nuevo: se lo damos al SuperAdministrador (para el resto, se asigna en la matriz).
insert into public.role_permissions (organization_id, role_id, module, can_view, can_edit)
select r.organization_id, r.id, 'control_stock', true, true
from public.roles r
where r.name = 'SuperAdministrador'
on conflict (role_id, module) do update set can_view = true, can_edit = true;

-- Aplica un conteo: fija el stock de cada variante al valor contado y registra el
-- ajuste. p_counts = [{ variant_id, quantity }].
create or replace function public.apply_stock_count(p_warehouse_id uuid, p_counts jsonb)
returns integer language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_el jsonb; v_variant uuid; v_new integer; v_old integer; v_delta integer; n integer := 0;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and organization_id = v_org) then
    raise exception 'Depósito inválido';
  end if;
  if p_counts is null or jsonb_array_length(p_counts) = 0 then raise exception 'El conteo está vacío'; end if;

  for v_el in select e from jsonb_array_elements(p_counts) as e
  loop
    v_variant := (v_el->>'variant_id')::uuid;
    v_new := greatest(0, coalesce((v_el->>'quantity')::integer, 0));
    select quantity into v_old from public.stock where warehouse_id = p_warehouse_id and variant_id = v_variant;
    v_delta := v_new - coalesce(v_old, 0);
    if v_delta = 0 then continue; end if;

    insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
    values (v_org, p_warehouse_id, v_variant, v_new)
    on conflict (warehouse_id, variant_id) do update set quantity = v_new, updated_at = now();

    insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
    values (v_org, p_warehouse_id, v_variant, v_delta, 'conteo', 'stock_count', null, auth.uid());
    n := n + 1;
  end loop;

  return n;  -- variantes ajustadas
end; $$;
