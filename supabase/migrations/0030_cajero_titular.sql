-- 0030_cajero_titular.sql — El rol titular/apoyo lo decide un flag por usuario, no el orden.
--  profiles.is_cash_titular: quién puede abrir la caja titular del local.
--  Apertura:
--    • Si ya hay una caja titular abierta en el local → la nueva es de APOYO (sin fondo).
--    • Si no hay titular abierta:
--        - usuario con is_cash_titular → abre TITULAR (arranca con la caja chica del local).
--        - usuario sin el flag → error: primero tiene que abrir un cajero titular.
-- Append-only e idempotente. Requiere 0029.

alter table public.profiles add column if not exists is_cash_titular boolean not null default false;

create or replace function public.open_cash_session(p_store_id uuid)
returns uuid language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_id uuid; v_role text; v_opening numeric; v_is_titular boolean;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if exists (select 1 from public.cash_sessions where organization_id = v_org and opened_by = auth.uid() and status = 'abierta') then
    raise exception 'Ya tenés una caja abierta. Cerrala antes de abrir otra.';
  end if;

  if exists (select 1 from public.cash_sessions where store_id = p_store_id and status = 'abierta' and role = 'titular') then
    -- Ya hay titular abierta: esta caja ayuda a vender.
    v_role := 'apoyo'; v_opening := 0;
  else
    -- No hay titular abierta: solo un cajero titular puede abrirla.
    select coalesce(is_cash_titular, false) into v_is_titular from public.profiles where id = auth.uid();
    if not coalesce(v_is_titular, false) then
      raise exception 'No hay una caja titular abierta. Esperá a que la abra un cajero titular.';
    end if;
    v_role := 'titular';
    select coalesce(balance, 0) into v_opening from public.store_petty where store_id = p_store_id;
    v_opening := coalesce(v_opening, 0);
  end if;

  insert into public.cash_sessions (organization_id, store_id, opening_amount, role, opened_by)
  values (v_org, p_store_id, v_opening, v_role, auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
