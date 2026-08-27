// Registra en Tiendanube los webhooks de pedidos que apuntan a Spera.
// Idempotente: no duplica los que ya existen (compara event+url).
//   node --env-file=.env.local scripts/tn-register-webhooks.mjs            → vista previa (lista + faltantes)
//   node --env-file=.env.local scripts/tn-register-webhooks.mjs --commit   → crea los faltantes
import { createClient } from "@supabase/supabase-js";

const ORG = "a9695a41-4c61-4680-bfee-68a0c3af32a8";
const UA = process.env.TIENDANUBE_USER_AGENT || "Spera (sistemabody@gmail.com)";
const BASE = (process.env.WEBHOOK_BASE || "https://spera-umber.vercel.app").replace(/\/$/, "");
const URL_ORDERS = `${BASE}/api/tiendanube/webhooks/orders`;
const EVENTS = ["order/created", "order/paid", "order/cancelled", "order/updated"];
const COMMIT = process.argv.includes("--commit");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: cred } = await sb.from("tiendanube_credentials").select("store_id, access_token").eq("organization_id", ORG).maybeSingle();
if (!cred) { console.error("No hay token TN guardado."); process.exit(1); }
const BASE_API = `https://api.tiendanube.com/v1/${cred.store_id}`;
const H = { Authentication: `bearer ${cred.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };

// Webhooks ya registrados.
const existing = [];
{
  const r = await fetch(`${BASE_API}/webhooks?per_page=200`, { headers: H });
  if (r.ok) existing.push(...(await r.json()));
  else if (r.status !== 404) { console.error("listar webhooks:", r.status, await r.text()); process.exit(1); }
}
console.log(`Webhooks existentes: ${existing.length}`);
for (const w of existing) console.log(`  • ${w.event}  →  ${w.url}`);

const have = new Set(existing.map((w) => `${w.event}|${w.url}`));
const missing = EVENTS.filter((e) => !have.has(`${e}|${URL_ORDERS}`));
console.log(`\nDestino: ${URL_ORDERS}`);
console.log(`Faltan crear: ${missing.length}`, missing.join(", ") || "(ninguno)");

if (!COMMIT) { console.log("\n(vista previa — corré con --commit para crear los faltantes)"); process.exit(0); }

for (const event of missing) {
  const r = await fetch(`${BASE_API}/webhooks`, { method: "POST", headers: H, body: JSON.stringify({ event, url: URL_ORDERS }) });
  if (r.ok) console.log(`  ✓ creado ${event}`);
  else console.error(`  ✗ ${event}:`, r.status, (await r.text()).slice(0, 160));
}
console.log("Listo.");
