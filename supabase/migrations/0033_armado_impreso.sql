-- 0033_armado_impreso.sql — Marca de "orden de armado impresa" para bloquear reimpresión.
--  Evita que se arme dos veces el mismo pedido: una vez impresa, el botón se bloquea.
-- Append-only e idempotente.

alter table public.sales add column if not exists armado_printed_at timestamptz;
alter table public.sales add column if not exists armado_printed_by uuid references auth.users(id);

-- Marca el armado como impreso solo la primera vez (idempotente: no pisa la marca previa).
create or replace function public.mark_armado_printed(p_sale_id uuid)
returns timestamptz language plpgsql as $$
declare v_org uuid := public.current_org_id(); v_at timestamptz;
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  update public.sales set armado_printed_at = now(), armado_printed_by = auth.uid()
    where id = p_sale_id and organization_id = v_org and armado_printed_at is null;
  select armado_printed_at into v_at from public.sales where id = p_sale_id and organization_id = v_org;
  return v_at;
end; $$;
