-- 0120_asistente.sql — Asistente IA: módulo gateado ESTRICTO + consulta de solo lectura.
--
-- Qué agrega (nada existente se modifica):
--   1) asistente_query(p_sql): ejecuta UNA consulta de SOLO LECTURA y devuelve jsonb.
--      Defensas en capas, independientes entre sí:
--        a) Permiso ESTRICTO por módulo 'asistente' (SIN bypass de admin: ni un
--           SuperAdministrador entra si su rol no tiene el permiso tildado en la matriz).
--           El service-role (auth.uid() null) pasa: la app ya guardó antes (requireAsistente).
--        b) La transacción se marca READ ONLY antes de ejecutar: cualquier INSERT/UPDATE/
--           DELETE (incluso escondido en un CTE) lo rechaza el motor de Postgres.
--        c) Lista negra de palabras de escritura/DDL y de tablas con secretos
--           (tiendanube_credentials, arca_auth_tickets, colas internas) y de los
--           esquemas auth/vault/storage.
--        d) Una sola sentencia (sin ';'), que empiece con SELECT o WITH.
--        e) Tope de filas (límite duro 1000) y de tamaño de respuesta (256 KB).
--      Límite honesto: esto vuelve IMPOSIBLE el accidente de escritura; no es un
--      sandbox contra un atacante con service-role (ese ya puede todo hoy).
--   2) Cada consulta queda registrada en audit_log (entity 'asistente').
--
-- Append-only e idempotente. Correr A MANO en el SQL Editor de Supabase.

create or replace function public.asistente_query(p_sql text, p_max_rows int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql    text := btrim(coalesce(p_sql, ''));
  v_max    int  := least(greatest(coalesce(p_max_rows, 200), 1), 1000);
  v_result jsonb;
  v_org    uuid;
begin
  -- (a) Permiso estricto: módulo 'asistente' tildado para el rol del usuario.
  --     Sin bypass de admin a propósito ("solo lo ve el dueño").
  if auth.uid() is not null and not exists (
    select 1
    from public.profiles pr
    join public.role_permissions rp on rp.role_id = pr.role_id
    where pr.id = auth.uid()
      and rp.module = 'asistente'
      and (rp.can_view or rp.can_edit)
  ) then
    raise exception 'No tenés permiso para usar el asistente.';
  end if;

  -- (d) Una sola sentencia, de lectura.
  v_sql := regexp_replace(v_sql, ';\s*$', '');          -- ';' final tolerado
  if v_sql = '' then
    raise exception 'Consulta vacía.';
  end if;
  if position(';' in v_sql) > 0 then
    raise exception 'Solo se permite UNA sentencia (sin ";").';
  end if;
  if v_sql !~* '^\s*(select|with)\M' then
    raise exception 'Solo se permiten consultas SELECT (o WITH ... SELECT).';
  end if;

  -- (c) Lista negra: escritura/DDL y datos sensibles. Capa extra sobre el READ ONLY.
  if v_sql ~* '\m(insert|update|delete|truncate|drop|alter|grant|revoke|copy|merge|vacuum|reindex|cluster|comment|lock|listen|notify|refresh|call|do|prepare|deallocate|security)\M' then
    raise exception 'Consulta rechazada: contiene una palabra de escritura/DDL no permitida.';
  end if;
  if v_sql ~* '\m(tiendanube_credentials|arca_auth_tickets|tn_stock_sync_queue|tn_sync_lock)\M'
     or v_sql ~* '\m(auth|vault|storage|pg_catalog)\s*\.'
     or v_sql ~* '\mpg_(authid|shadow|user_mapping)' then
    raise exception 'Consulta rechazada: esa tabla/esquema no está disponible para el asistente.';
  end if;

  -- (2) Auditoría ANTES de volvernos read-only (si el log falla, no rompe la consulta).
  begin
    select id into v_org from public.organizations order by created_at limit 1;
    insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, detail)
    values (v_org, auth.uid(), 'consulta', 'asistente', null,
            jsonb_build_object('sql', left(v_sql, 2000)));
  exception when others then
    null;
  end;

  -- (b) Desde acá, la transacción es de SOLO LECTURA: el motor rechaza toda escritura.
  perform set_config('transaction_read_only', 'on', true);

  -- (e) Ejecutar con tope de filas y devolver jsonb.
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from (%s) q limit %s) t',
    v_sql, v_max
  ) into v_result;

  if octet_length(v_result::text) > 262144 then
    raise exception 'El resultado es demasiado grande (>256 KB). Agregá filtros o agrupá.';
  end if;

  return v_result;
end;
$$;

-- Solo el servidor (service-role) puede llamarla. Nadie más, ni logueado.
revoke all on function public.asistente_query(text, int) from public;
revoke all on function public.asistente_query(text, int) from anon;
revoke all on function public.asistente_query(text, int) from authenticated;
grant execute on function public.asistente_query(text, int) to service_role;
