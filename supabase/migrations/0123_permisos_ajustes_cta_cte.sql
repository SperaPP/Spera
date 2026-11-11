-- 0123_permisos_ajustes_cta_cte.sql — Ajustes de cuenta corriente por PERMISO, no por rol.
--
-- adjust_customer_balance exigía is_admin() (rol 'Administrador'/'SuperAdministrador' por nombre):
-- un Supervisor con todos los permisos tildados no podía ajustar saldos (caso Carola Ciceri,
-- 6/11/2026). Ahora pide has_perm('cobranzas', true), que se maneja desde la matriz de /usuarios.
-- Único cambio: el guard. El resto de la función es idéntico a 0110 (verificado contra producción).
--
-- Append-only e idempotente. Correr A MANO en el SQL Editor de Supabase.

create or replace function public.adjust_customer_balance(p_customer_id uuid, p_delta numeric, p_reason text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  perform set_config('app.cust_bal', '1', true);  -- habilita escribir customers.balance
  if v_org is null then raise exception 'Sin organización'; end if;
  -- 0123: antes exigía ser Administrador (por nombre de rol). Ahora el permiso
  -- Cobranzas (editar) de la matriz; has_perm() incluye a los administradores.
  if auth.uid() is not null and not public.has_perm('cobranzas', true) then
    raise exception 'No tenés permiso para hacer ajustes de cuenta corriente (requiere Cobranzas: editar)';
  end if;
  if p_delta = 0 then raise exception 'El ajuste no puede ser cero'; end if;

  update public.customers set balance = balance + p_delta
    where id = p_customer_id and organization_id = v_org;
  if not found then raise exception 'Cliente no encontrado'; end if;

  insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, note, created_by)
  values (v_org, p_customer_id, p_delta, 'ajuste', 'adjustment', nullif(trim(coalesce(p_reason,'')),''), auth.uid());
end $$;

notify pgrst, 'reload schema';
