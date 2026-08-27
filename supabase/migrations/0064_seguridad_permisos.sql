-- 0064_seguridad_permisos.sql — cierre de escalada de privilegios (auditoría pre-prod).
--
-- Problema raíz: el RLS estaba scopeado SOLO por organización; la autorización por
-- rol vivía únicamente en los guards de las server actions, evitables llamando a
-- PostgREST/RPC directo con la sesión del usuario (la anon key viaja en el browser).
-- Esta migración pone la autorización en la base para las superficies críticas:
--   1. Un usuario no puede auto-asignarse rol/local/titularidad (trigger).
--   2. roles y role_permissions solo los escribe un admin.
--   3. anular ventas y ajustar stock exigen permiso adecuado dentro de la RPC.
--   4. escribir clientes (saldo) y precios exige permiso de módulo.
-- Append-only e idempotente. NO restringe LECTURAS (se endurecen aparte, con test).

-- ── Helper de permisos por módulo ─────────────────────────────────────────────
create or replace function public.has_perm(p_module text, p_edit boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profiles pr
    join public.role_permissions rp on rp.role_id = pr.role_id
    where pr.id = auth.uid() and rp.module = p_module
      and (case when p_edit then rp.can_edit else (rp.can_view or rp.can_edit) end)
  );
$$;

-- ── 1) Un usuario NO puede cambiarse rol/org/local/titularidad de caja ─────────
-- El service-role (alta/edición de usuarios) tiene auth.uid()=null → pasa. Un admin
-- editando por la app (auth.uid() seteado + is_admin) → pasa. Cualquier otro → bloqueado.
create or replace function public.guard_profile_privileges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role_id         is distinct from old.role_id
    or new.organization_id is distinct from old.organization_id
    or new.store_id        is distinct from old.store_id
    or new.is_cash_titular is distinct from old.is_cash_titular then
      raise exception 'No podés modificar tu rol, organización, local ni titularidad de caja';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- ── 2) roles y role_permissions: lectura por org, escritura solo admin ─────────
drop policy if exists roles_all on public.roles;
drop policy if exists roles_select on public.roles;
drop policy if exists roles_admin_write on public.roles;
create policy roles_select on public.roles for select
  using (organization_id = public.current_org_id());
create policy roles_admin_write on public.roles for all
  using (public.is_admin() and organization_id = public.current_org_id())
  with check (public.is_admin() and organization_id = public.current_org_id());

drop policy if exists role_permissions_all on public.role_permissions;
drop policy if exists role_permissions_select on public.role_permissions;
drop policy if exists role_permissions_admin_write on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select
  using (organization_id = public.current_org_id());
create policy role_permissions_admin_write on public.role_permissions for all
  using (public.is_admin() and organization_id = public.current_org_id())
  with check (public.is_admin() and organization_id = public.current_org_id());

-- Nota: la protección de escritura directa a customers.balance y price_list_items
-- (borrar deuda / cambiar precios vía API) requiere convertir las RPC que las
-- escriben a SECURITY DEFINER + un candado de columna, para no romper las ventas
-- legítimas. Se hace en un fast-follow con smoke-test (ver 0065+). Acá NO se toca.

-- ── 3) Guards de rol dentro de las RPC destructivas ───────────────────────────
-- cancel_sale: anular es acción de administrador.
create or replace function public.cancel_sale(p_sale_id uuid)
returns void language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_wh uuid; v_customer uuid; v_coupon uuid; v_channel text; v_fs text; v_it record; v_net numeric;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not public.is_admin() then raise exception 'Solo un administrador puede anular ventas'; end if;

  select s.customer_id, s.coupon_id, s.channel, s.fulfillment_status, st.warehouse_id
    into v_customer, v_coupon, v_channel, v_fs, v_wh
  from public.sales s join public.stores st on st.id = s.store_id
  where s.id = p_sale_id and s.organization_id = v_org and s.status = 'completada'
  for update of s;
  if not found then raise exception 'Venta no encontrada o ya anulada'; end if;

  if v_channel = 'cambio' then
    raise exception 'Esta venta proviene de un cambio. Para deshacerlo hacé el cambio inverso; no se anula directamente.';
  end if;

  if v_fs = 'despachado' then
    raise exception 'Este pedido ya fue despachado. Para revertirlo hacé una devolución/ajuste; no se anula directamente.';
  end if;

  if exists (select 1 from public.sale_items where sale_id = p_sale_id and returned_qty > 0) then
    raise exception 'Esta venta tiene prendas ya devueltas o cambiadas. Revertí el cambio antes de anular.';
  end if;

  for v_it in select variant_id, quantity from public.sale_items where sale_id = p_sale_id
  loop
    if v_fs in ('pendiente', 'controlado') then
      update public.stock set reserved = greatest(coalesce(reserved,0) - v_it.quantity, 0), updated_at = now()
        where warehouse_id = v_wh and variant_id = v_it.variant_id;
    else
      insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
      values (v_org, v_wh, v_it.variant_id, v_it.quantity)
      on conflict (warehouse_id, variant_id) do update set quantity = public.stock.quantity + v_it.quantity, updated_at = now();
      insert into public.stock_movements (organization_id, warehouse_id, variant_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_wh, v_it.variant_id, v_it.quantity, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
    end if;
  end loop;

  if v_customer is not null then
    select coalesce(sum(delta), 0) into v_net
      from public.customer_movements where reference_type = 'sale' and reference_id = p_sale_id and customer_id = v_customer;
    if v_net <> 0 then
      update public.customers set balance = balance - v_net where id = v_customer;
      insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, reference_id, created_by)
      values (v_org, v_customer, -v_net, 'anulacion', 'sale_cancel', p_sale_id, auth.uid());
    end if;
  end if;

  if v_coupon is not null then
    update public.coupons set used_count = greatest(used_count - 1, 0) where id = v_coupon;
  end if;

  update public.sales set status = 'anulada' where id = p_sale_id;
end; $$;

-- adjust_stock: ajuste manual exige permiso de stock/control_stock.
create or replace function public.adjust_stock(
  p_warehouse_id uuid,
  p_variant_id   uuid,
  p_new_quantity integer,
  p_reason       text
) returns integer language plpgsql as $$
declare
  v_org     uuid := public.current_org_id();
  v_current integer;
  v_delta   integer;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if not (public.has_perm('control_stock', true) or public.has_perm('stock', true)) then
    raise exception 'No tenés permiso para ajustar stock';
  end if;
  if p_new_quantity < 0 then raise exception 'La cantidad no puede ser negativa'; end if;

  select quantity into v_current
  from public.stock where warehouse_id = p_warehouse_id and variant_id = p_variant_id for update;
  v_current := coalesce(v_current, 0);
  v_delta := p_new_quantity - v_current;

  if v_delta = 0 then return p_new_quantity; end if;

  insert into public.stock (organization_id, warehouse_id, variant_id, quantity)
  values (v_org, p_warehouse_id, p_variant_id, p_new_quantity)
  on conflict (warehouse_id, variant_id) do update
    set quantity = p_new_quantity,
        reserved = least(public.stock.reserved, p_new_quantity),
        updated_at = now();

  insert into public.stock_movements
    (organization_id, warehouse_id, variant_id, delta, reason, reference_type, created_by)
  values (v_org, p_warehouse_id, p_variant_id, v_delta, coalesce(nullif(p_reason,''),'ajuste'), 'stock_adjust', auth.uid());

  return p_new_quantity;
end; $$;
