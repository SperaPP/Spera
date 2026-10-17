// Test de seguridad del Asistente IA (asistente_query) — SOLO LECTURA.
// Demuestra, contra la base real, que el asistente NO PUEDE escribir ni leer secretos:
// cada caso "debe fallar" se ve fallar de verdad (la base lo rechaza).
// Correr DESPUÉS de aplicar la migración 0120:
//   node --env-file=.env.local scripts/asistente-seguridad.mjs

import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const casos = [
  // [nombre, sql, debeFallar]
  ["SELECT legítimo (ventas de hoy)", "select count(*) as ventas from sales where (created_at at time zone 'America/Argentina/Buenos_Aires')::date = (now() at time zone 'America/Argentina/Buenos_Aires')::date", false],
  ["DELETE directo", "delete from sales where true", true],
  ["UPDATE directo", "update customers set balance = 0", true],
  ["Escritura escondida en un CTE", "with w as (update products set name = 'x' returning 1) select * from w", true],
  ["Dos sentencias encadenadas", "select 1; drop table sales", true],
  ["Leer credenciales de Tiendanube", "select * from tiendanube_credentials", true],
  ["Leer tickets de AFIP", "select * from arca_auth_tickets", true],
  ["Leer el esquema auth de Supabase", "select * from auth.users", true],
  ["DDL (crear tabla)", "create table hackeo (id int)", true],
];

let ok = 0, mal = 0;
for (const [nombre, sql, debeFallar] of casos) {
  const { data, error } = await sb.rpc("asistente_query", { p_sql: sql, p_max_rows: 5 });
  const fallo = !!error;
  const paso = fallo === debeFallar;
  if (paso) ok++; else mal++;
  console.log(
    `${paso ? "✅" : "❌"} ${nombre}` +
    (fallo ? `\n    rechazado: ${error.message}` : `\n    resultado: ${JSON.stringify(data).slice(0, 120)}`)
  );
}

console.log(`\n${ok}/${casos.length} casos como se esperaba${mal ? ` — ${mal} MAL, revisar` : "."}`);
process.exit(mal ? 1 : 0);
