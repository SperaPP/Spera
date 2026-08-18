-- 0028_caja_periodos.sql — Caja por cajero + estado "entregada" (rendición).
--  Un período = una caja por USUARIO (varios cajeros pueden tener la suya abierta
--  a la vez en el mismo local). Estados: abierta → cerrada → entregada.
--  Append-only e idempotente.

alter table public.cash_sessions drop constraint if exists cash_sessions_status_check;
alter table public.cash_sessions add constraint cash_sessions_status_check
  check (status in ('abierta', 'cerrada', 'entregada'));
alter table public.cash_sessions add column if not exists entregada_at timestamptz;
alter table public.cash_sessions add column if not exists entregada_by uuid references auth.users(id);

-- Abrir: una sola caja abierta POR USUARIO (no por local).
create or replace function public.open_cash_session(p_store_id uuid, p_opening_amount numeric)
returns uuid language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_id uuid;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if exists (select 1 from public.cash_sessions where organization_id = v_org and opened_by = auth.uid() and status = 'abierta') then
    raise exception 'Ya tenés una caja abierta. Cerrala antes de abrir un nuevo período.';
  end if;
  insert into public.cash_sessions (organization_id, store_id, opening_amount, opened_by)
  values (v_org, p_store_id, coalesce(p_opening_amount,0), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;

-- Entregar: el período cerrado viaja a administración.
create or replace function public.deliver_cash_session(p_session_id uuid)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  update public.cash_sessions
     set status = 'entregada', entregada_at = now(), entregada_by = auth.uid()
   where id = p_session_id and organization_id = v_org and status = 'cerrada';
  if not found then raise exception 'Período no encontrado o no está cerrado'; end if;
end; $$;
