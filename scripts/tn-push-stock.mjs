// Empuja a Tiendanube el stock DISPONIBLE (físico − reservado) del depósito
// Mayorista-Central, SOLO para las variantes adoptadas (tiendanube_links).
// Escribe únicamente las que difieren del stock que hoy tiene TN.
//   node --env-file=.env.local scripts/tn-push-stock.mjs                 → vista previa (no escribe)
//   node --env-file=.env.local scripts/tn-push-stock.mjs --limit 3 --commit  → prueba con 3
//   node --env-file=.env.local scripts/tn-push-stock.mjs --commit        → push completo
import { createClient } from "@supabase/supabase-js";

const ORG = "a9695a41-4c61-4680-bfee-68a0c3af32a8";            // Bodysculpt
const WH_CENTRAL = "2398d79a-fbb4-4b58-8ac9-1b78f3207c77";     // Mayorista - Central
const UA = process.env.TIENDANUBE_USER_AGENT || "Spera (sistemabody@gmail.com)";
const COMMIT = process.argv.includes("--commit");
const limArg = process.argv.indexOf("--limit");
const LIMIT = limArg > -1 ? parseInt(process.argv[limArg + 1], 10) : Infinity;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: cred } = await sb.from("tiendanube_credentials").select("store_id, access_token").eq("organization_id", ORG).maybeSingle();
if (!cred) { console.error("No hay token TN guardado."); process.exit(1); }
const BASE = `https://api.tiendanube.com/v1/${cred.store_id}`;
const H = { Authentication: `bearer ${cred.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Links adoptados (variante Spera ↔ variante TN).
const links = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("tiendanube_links").select("variant_id, tn_product_id, tn_variant_id").eq("organization_id", ORG).range(from, from + 999);
  if (error) { console.error("links:", error.message); process.exit(1); }
  if (!data.length) break;
  links.push(...data);
  if (data.length < 1000) break;
}
console.log("Variantes adoptadas (links):", links.length);

// 2) Disponible en Mayorista-Central por variante (físico − reservado; nunca < 0).
const dispByVar = new Map();
const varIds = links.map((l) => l.variant_id);
for (let i = 0; i < varIds.length; i += 200) {
  const chunk = varIds.slice(i, i + 200);
  const { data, error } = await sb.from("stock").select("variant_id, quantity, reserved").eq("warehouse_id", WH_CENTRAL).in("variant_id", chunk);
  if (error) { console.error("stock:", error.message); process.exit(1); }
  for (const s of data) dispByVar.set(s.variant_id, Math.max(0, (s.quantity ?? 0) - (s.reserved ?? 0)));
}
// Variante sin fila de stock en Central = 0 disponible.
for (const l of links) if (!dispByVar.has(l.variant_id)) dispByVar.set(l.variant_id, 0);

// 3) Stock actual en TN (para escribir solo las que cambian). Traigo el catálogo una vez.
const tnStock = new Map(); // tn_variant_id -> stock actual en TN
let url = `${BASE}/products?fields=id,variants&per_page=200&page=1`, guard = 0;
while (url && guard++ < 200) {
  const r = await fetch(url, { headers: H });
  if (r.status === 404) break;
  if (!r.ok) { console.error("TN read error", r.status, await r.text()); process.exit(1); }
  for (const p of await r.json()) for (const v of p.variants ?? []) tnStock.set(String(v.id), v.stock == null ? null : Number(v.stock));
  const next = r.headers.get("link")?.split(",").find((s) => /rel="next"/.test(s));
  url = next ? next.slice(next.indexOf("<") + 1, next.indexOf(">")) : null;
}

// 4) Diferencias a escribir.
const changes = [];
for (const l of links) {
  const target = dispByVar.get(l.variant_id) ?? 0;
  const current = tnStock.get(l.tn_variant_id);
  if (current !== target) changes.push({ ...l, target, current });
}
console.log(`A actualizar en TN: ${changes.length} de ${links.length} (las que difieren)`);
for (const c of changes.slice(0, 8)) console.log(`  var ${c.tn_variant_id}: TN ${c.current} → ${c.target}`);
if (!COMMIT) { console.log("\n(vista previa — corré con --commit para escribir en la web)"); process.exit(0); }

// 5) Push (PUT por variante). Respeta rate limit (429 → espera y reintenta).
const toDo = changes.slice(0, LIMIT);
console.log(`\nEscribiendo ${toDo.length}${LIMIT !== Infinity ? " (limitado)" : ""}...`);
let ok = 0, fail = 0;
for (const c of toDo) {
  let attempt = 0;
  for (;;) {
    const r = await fetch(`${BASE}/products/${c.tn_product_id}/variants/${c.tn_variant_id}`, { method: "PUT", headers: H, body: JSON.stringify({ stock: c.target }) });
    if (r.status === 429) { await sleep(2000 * ++attempt); if (attempt < 5) continue; }
    if (r.ok) { ok++; } else { fail++; if (fail <= 10) console.error(`  ✗ var ${c.tn_variant_id}:`, r.status, (await r.text()).slice(0, 120)); }
    break;
  }
  if ((ok + fail) % 100 === 0) console.log(`  ${ok + fail}/${toDo.length}`);
  await sleep(300); // ~3 req/s, prudente con el rate limit de TN
}
console.log(`✓ Push terminado: ${ok} ok, ${fail} con error`);
