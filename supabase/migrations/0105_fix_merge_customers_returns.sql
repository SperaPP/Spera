-- 0105_fix_merge_customers_returns.sql — arregla "relation public.returns does not exist".
--
-- merge_customers (0092) re-vincula varias tablas al unificar clientes, entre ellas
-- public.returns. Esa tabla (de la migración 0008) no existe en esta base: las
-- devoluciones se registran vía cancel_sale (returned_qty + movimiento de cuenta) y los
-- cambios en public.exchanges. La referencia a returns hacía fallar toda la unificación.
--
-- Solución: guardar el update de returns con to_regclass (solo corre si la tabla existe).
-- Igual criterio para exchanges, por robustez entre entornos. Todo lo demás, idéntico a 0092.
-- Append-only e idempotente.

create or replace function public.merge_customers(p_target uuid, p_sources jsonb)
returns jsonb language plpgsql as $$
declare
  v_org uuid := public.current_org_id();
  v_src uuid; v_txt text; v_bal numeric; v_auth uuid; v_email text; v_phone text;
  v_tgt_auth uuid; v_tgt_email text; v_tgt_phone text;
  v_moved int := 0; v_portal_conflicts int := 0;
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  if not public.is_admin() then raise exception 'Solo un administrador puede unificar clientes'; end if;
  if p_target is null or p_sources is null or jsonb_array_length(p_sources) = 0 then raise exception 'Faltan datos'; end if;

  perform 1 from public.customers where id = p_target and organization_id = v_org for update;
  if not found then raise exception 'Cuenta principal inválida'; end if;
  select auth_user_id, email, phone into v_tgt_auth, v_tgt_email, v_tgt_phone from public.customers where id = p_target;

  for v_txt in select value from jsonb_array_elements_text(p_sources) loop
    v_src := v_txt::uuid;
    if v_src = p_target then raise exception 'La cuenta principal no puede estar entre las duplicadas'; end if;
    select balance, auth_user_id, email, phone into v_bal, v_auth, v_email, v_phone
      from public.customers where id = v_src and organization_id = v_org for update;
    if not found then continue; end if;

    -- Re-vincular todas las referencias a la principal.
    update public.sales             set customer_id = p_target where customer_id = v_src;
    update public.receipts          set customer_id = p_target where customer_id = v_src;
    update public.customer_movements set customer_id = p_target where customer_id = v_src;
    -- returns/exchanges: solo si la tabla existe en esta base (evita el error de relación inexistente).
    if to_regclass('public.returns')   is not null then update public.returns   set customer_id = p_target where customer_id = v_src; end if;
    if to_regclass('public.exchanges') is not null then update public.exchanges set customer_id = p_target where customer_id = v_src; end if;

    -- Saldo → se suma en la principal.
    if coalesce(v_bal, 0) <> 0 then
      update public.customers set balance = balance + v_bal where id = p_target;
    end if;

    -- Portal: mover el login si la principal no tiene; si ambas tienen, queda el de la principal.
    if v_auth is not null then
      if v_tgt_auth is null then
        update public.customers set auth_user_id = null where id = v_src;  -- liberar antes (índice único)
        update public.customers set auth_user_id = v_auth where id = p_target;
        v_tgt_auth := v_auth;
      else
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

  return jsonb_build_object('unificadas', v_moved, 'conflictos_portal', v_portal_conflicts);
end $$;

notify pgrst, 'reload schema';
