-- 0073_auditoria.sql — registro de auditoría: quién toca qué.
--
-- Tabla audit_log + trigger genérico tg_audit() que registra INSERT/UPDATE/DELETE
-- sobre las tablas relevantes, con el usuario (auth.uid()), la acción, la entidad y
-- un detalle compacto (en UPDATE: solo los campos que cambiaron). El trigger es
-- SECURITY DEFINER y a prueba de errores: si el log falla, NUNCA rompe la operación.
-- Lectura: solo admin. Escritura: solo el trigger (service-role).
-- Append-only e idempotente.

create table if not exists public.audit_log (
  id              bigint generated always as identity primary key,
  organization_id uuid,
  actor_id        uuid,
  action          text not null,          -- insert | update | delete
  entity          text not null,          -- nombre de la tabla
  entity_id       uuid,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists audit_log_org_time_idx on public.audit_log (organization_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity, created_at desc);

alter table public.audit_log enable row level security;
drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log for select
  using (public.is_admin() and organization_id = public.current_org_id());

create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row    jsonb := to_jsonb(coalesce(new, old));
  v_detail jsonb;
begin
  begin
    if tg_op = 'UPDATE' then
      select coalesce(jsonb_object_agg(o.key, jsonb_build_object('de', o.value, 'a', n.value)), '{}'::jsonb)
        into v_detail
      from jsonb_each(to_jsonb(old)) o
      join jsonb_each(to_jsonb(new)) n on n.key = o.key
      where o.value is distinct from n.value and o.key <> 'updated_at';
      if v_detail = '{}'::jsonb then return coalesce(new, old); end if; -- nada relevante cambió
    else
      v_detail := v_row;
    end if;
    -- Nunca guardar secretos.
    v_detail := v_detail - 'access_token' - 'password' - 'password_hash';

    insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, detail)
    values ((v_row->>'organization_id')::uuid, auth.uid(), lower(tg_op), tg_table_name, (v_row->>'id')::uuid, v_detail);
  exception when others then
    null; -- el log jamás rompe la operación de negocio
  end;
  return coalesce(new, old);
end; $$;

-- Adjuntar a las tablas relevantes (insert/update/delete).
do $$
declare t text;
begin
  foreach t in array array[
    'sales','receipts','price_list_items','stock_transfers','cash_sessions',
    'roles','role_permissions','products','coupons','payment_methods',
    'stores','warehouses','tiendanube_credentials',
    'categories','main_categories','seasons','sizes','colors','fabric_types',
    'customer_types','shipping_methods'
  ]
  loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.tg_audit()', t);
  end loop;
end $$;

-- profiles: solo cambios sensibles (rol / local / titularidad), no todo touch.
drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after update on public.profiles for each row
  when (new.role_id is distinct from old.role_id
     or new.store_id is distinct from old.store_id
     or new.is_cash_titular is distinct from old.is_cash_titular)
  execute function public.tg_audit();

-- customers: alta siempre; edición solo cuando NO es un cambio de saldo (el saldo se
-- mueve en cada venta/cobranza → sería ruido; eso ya queda en la venta/cobranza).
drop trigger if exists audit_customers_ins on public.customers;
create trigger audit_customers_ins after insert on public.customers for each row execute function public.tg_audit();
drop trigger if exists audit_customers_upd on public.customers;
create trigger audit_customers_upd after update on public.customers for each row
  when (new.balance is not distinct from old.balance) execute function public.tg_audit();

-- stock_movements: solo ajustes/conteos manuales (no el movimiento de cada venta).
drop trigger if exists audit_stock_adjust on public.stock_movements;
create trigger audit_stock_adjust after insert on public.stock_movements for each row
  when (new.reason not in ('venta','despacho','cambio','anulacion','transferencia'))
  execute function public.tg_audit();
