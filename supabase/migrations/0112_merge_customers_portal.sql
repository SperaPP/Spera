-- 0112_merge_customers_portal.sql — auditoría de sistema #8 (portal al unificar).
--
-- Al unificar un cliente de mostrador (principal, sin portal) con un duplicado que SÍ
-- tiene portal, merge_customers movía el login pero NO el portal_status ni el
-- customer_type_id → la cuenta unificada quedaba "en revisión" y sin lista de precios
-- (no podía usar el portal). Además, cuando ambas tenían login, borraba el duplicado
-- dejando su usuario de Auth HUÉRFANO (login muerto).
--
-- Ahora:
--   • Si la principal no tiene login y el duplicado sí, se mueve el login Y se hereda
--     el acceso: portal_status 'aprobado' (si el duplicado lo estaba) y la lista
--     (customer_type_id) si a la principal le falta.
--   • Los auth_user_id que quedan sin dueño (conflicto: ambas tenían login) se
--     devuelven en 'auth_huerfanos' para que la acción del server los elimine de Auth.
-- Resto idéntico a 0105 (returns/exchanges con to_regclass). Append-only e idempotente.

create or replace function public.merge_customers(p_target uuid, p_sources jsonb)
returns jsonb language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_src uuid; v_txt text; v_bal numeric; v_auth uuid; v_email text; v_phone text;
  v_src_pstatus text; v_src_ctype uuid;
  v_tgt_auth uuid; v_tgt_email text; v_tgt_phone text; v_tgt_pstatus text; v_tgt_ctype uuid;
  v_moved int := 0; v_portal_conflicts int := 0; v_orphans jsonb := '[]'::jsonb;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  if not public.is_admin() then raise exception 'Solo un administrador puede unificar clientes'; end if;
  if p_target is null or p_sources is null or jsonb_array_length(p_sources) = 0 then raise exception 'Faltan datos'; end if;

  perform 1 from public.customers where id = p_target and organization_id = v_org for update;
  if not found then raise exception 'Cuenta principal inválida'; end if;
  select auth_user_id, email, phone, portal_status, customer_type_id
    into v_tgt_auth, v_tgt_email, v_tgt_phone, v_tgt_pstatus, v_tgt_ctype
    from public.customers where id = p_target;

  for v_txt in select value from jsonb_array_elements_text(p_sources) loop
    v_src := v_txt::uuid;
    if v_src = p_target then raise exception 'La cuenta principal no puede estar entre las duplicadas'; end if;
    select balance, auth_user_id, email, phone, portal_status, customer_type_id
      into v_bal, v_auth, v_email, v_phone, v_src_pstatus, v_src_ctype
      from public.customers where id = v_src and organization_id = v_org for update;
    if not found then continue; end if;

    -- Re-vincular todas las referencias a la principal.
    update public.sales             set customer_id = p_target where customer_id = v_src;
    update public.receipts          set customer_id = p_target where customer_id = v_src;
    update public.customer_movements set customer_id = p_target where customer_id = v_src;
    if to_regclass('public.returns')   is not null then update public.returns   set customer_id = p_target where customer_id = v_src; end if;
    if to_regclass('public.exchanges') is not null then update public.exchanges set customer_id = p_target where customer_id = v_src; end if;

    -- Saldo → se suma en la principal.
    if coalesce(v_bal, 0) <> 0 then
      update public.customers set balance = balance + v_bal where id = p_target;
    end if;

    -- Portal: mover el login si la principal no tiene; si ambas tienen, queda el de
    -- la principal y el login del duplicado queda huérfano (se devuelve para limpiar).
    if v_auth is not null then
      if v_tgt_auth is null then
        update public.customers set auth_user_id = null where id = v_src;  -- liberar antes (índice único)
        -- Mueve el login Y hereda el acceso al portal del duplicado.
        update public.customers set
          auth_user_id = v_auth,
          portal_status = case when coalesce(v_tgt_pstatus,'') <> 'aprobado' and v_src_pstatus = 'aprobado'
                               then 'aprobado' else portal_status end,
          customer_type_id = coalesce(customer_type_id, v_src_ctype)
        where id = p_target;
        v_tgt_auth := v_auth;
        if coalesce(v_tgt_pstatus,'') <> 'aprobado' and v_src_pstatus = 'aprobado' then v_tgt_pstatus := 'aprobado'; end if;
        v_tgt_ctype := coalesce(v_tgt_ctype, v_src_ctype);
      else
        v_orphans := v_orphans || to_jsonb(v_auth::text);
        v_portal_conflicts := v_portal_conflicts + 1;
      end if;
    end if;

    -- Completar contacto vacío de la principal.
    if v_tgt_email is null and v_email is not null then update public.customers set email = v_email where id = p_target; v_tgt_email := v_email; end if;
    if v_tgt_phone is null and v_phone is not null then update public.customers set phone = v_phone where id = p_target; v_tgt_phone := v_phone; end if;

    -- Eliminar la cuenta duplicada (ya sin datos vinculados).
    delete from public.customers where id = v_src;
    v_moved := v_moved + 1;
  end loop;

  return jsonb_build_object(
    'unificadas', v_moved,
    'conflictos_portal', v_portal_conflicts,
    'auth_huerfanos', v_orphans
  );
end $$;

notify pgrst, 'reload schema';
