-- 0036_ajuste_saldo_cliente.sql — Ajuste manual del saldo de cuenta corriente.
--  Permite corregir el saldo de un cliente (write-off, saldo inicial, corrección
--  de error) dejando registro en la cuenta corriente como movimiento 'ajuste'.
--  Convención delta: + suma deuda, − resta deuda (a favor).
-- Append-only e idempotente.

alter table public.customer_movements add column if not exists note text;

create or replace function public.adjust_customer_balance(p_customer_id uuid, p_delta numeric, p_reason text)
returns void language plpgsql as $$
declare v_org uuid := public.current_org_id();
begin
  if v_org is null then raise exception 'Sin organización'; end if;
  if p_delta = 0 then raise exception 'El ajuste no puede ser cero'; end if;

  update public.customers set balance = balance + p_delta
    where id = p_customer_id and organization_id = v_org;
  if not found then raise exception 'Cliente no encontrado'; end if;

  insert into public.customer_movements (organization_id, customer_id, delta, reason, reference_type, note, created_by)
  values (v_org, p_customer_id, p_delta, 'ajuste', 'adjustment', nullif(trim(coalesce(p_reason,'')),''), auth.uid());
end $$;
