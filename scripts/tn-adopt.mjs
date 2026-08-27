// Adopta en Spera las variantes que YA existen en Tiendanube (match por SKU):
//   - llena tiendanube_links (variante Spera ↔ variante TN)
//   - prende products.tn_sync = true en esos productos
// NO escribe nada en Tiendanube (solo GET a TN + writes a Supabase).
//   node --env-file=.env.local scripts/tn-adopt.mjs            → vista previa
//   node --env-file=.env.local scripts/tn-adopt.mjs --commit   → escribe
import { createClient } from "@supabase/supabase-js";

const ORG = "a9695a41-4c61-4680-bfee-68a0c3af32a8"; // Bodysculpt
const UA = process.env.TIENDANUBE_USER_AGENT || "Spera (sistemabody@gmail.com)";
const COMMIT = process.argv.includes("--commit");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: cred } = await sb.from("tiendanube_credentials").select("store_id, access_token").eq("organization_id", ORG).maybeSingle();
if (!cred) { console.error("No hay token TN guardado."); process.exit(1); }
const H = { Authentication: `bearer ${cred.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };

// 1) Traer todas las variantes de TN con SKU (paginado por Link header).
const tnBySku = new Map(); // sku(lower) -> { tn_product_id, tn_variant_id }
let url = `https://api.tiendanube.com/v1/${cred.store_id}/products?fields=id,variants&per_page=200&page=1`;
let guard = 0;
while (url && guard++ < 200) {
  const r = await fetch(url, { headers: H });
  if (r.status === 404) break;
  if (!r.ok) { console.error("TN error", r.status, await r.text()); process.exit(1); }
  for (const p of await r.json()) {
    for (const v of p.variants ?? []) {
      const sku = v.sku ? String(v.sku).trim().toLowerCase() : null;
      if (!sku) continue;
      if (!tnBySku.has(sku)) tnBySku.set(sku, { tn_product_id: String(p.id), tn_variant_id: String(v.id) }); // 1er match ante SKU dup interno
    }
  }
  const next = r.headers.get("link")?.split(",").find((s) => /rel="next"/.test(s));
  url = next ? next.slice(next.indexOf("<") + 1, next.indexOf(">")) : null;
}
console.log("SKUs distintos en TN:", tnBySku.size);

// 2) Variantes de Spera por SKU.
const skuToVar = new Map(); // sku(lower) -> { variant_id, product_id }
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("product_variants").select("id, sku, product_id").eq("organization_id", ORG).not("sku", "is", null).range(from, from + 999);
  if (error) { console.error("variants:", error.message); process.exit(1); }
  if (!data.length) break;
  for (const v of data) if (v.sku) skuToVar.set(String(v.sku).trim().toLowerCase(), { variant_id: v.id, product_id: v.product_id });
  if (data.length < 1000) break;
}
console.log("SKUs en Spera:", skuToVar.size);

// 3) Cruce: armar links + set de productos a sincronizar.
const nowIso = new Date().toISOString();
const links = [];
const prodIds = new Set();
for (const [sku, tn] of tnBySku) {
  const sp = skuToVar.get(sku);
  if (!sp) continue;
  links.push({ organization_id: ORG, variant_id: sp.variant_id, tn_product_id: tn.tn_product_id, tn_variant_id: tn.tn_variant_id, last_synced_at: nowIso });
  prodIds.add(sp.product_id);
}
console.log(`Cruce por SKU: ${links.length} variantes en AMBOS → ${prodIds.size} productos a marcar tn_sync`);

if (!COMMIT) { console.log("\n(vista previa — corré con --commit para escribir)"); process.exit(0); }

// 4a) Upsert de links (idempotente por unique(org, variant_id)).
let l = 0;
for (let i = 0; i < links.length; i += 500) {
  const { error } = await sb.from("tiendanube_links").upsert(links.slice(i, i + 500), { onConflict: "organization_id,variant_id" });
  if (error) { console.error("links:", error.message); process.exit(1); }
  l += Math.min(500, links.length - i);
  console.log(`  links ${l}/${links.length}`);
}

// 4b) Prender tn_sync en los productos adoptados (por lotes de IDs).
const ids = [...prodIds];
let p = 0;
for (let i = 0; i < ids.length; i += 300) {
  const chunk = ids.slice(i, i + 300);
  const { error } = await sb.from("products").update({ tn_sync: true }).in("id", chunk);
  if (error) { console.error("tn_sync:", error.message); process.exit(1); }
  p += chunk.length;
  console.log(`  tn_sync ${p}/${ids.length}`);
}
console.log(`✓ Adoptados: ${l} links, ${p} productos con tn_sync=true`);
