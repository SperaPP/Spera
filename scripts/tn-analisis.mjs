// Análisis read-only: cruza el catálogo de Tiendanube con Spera por SKU.
// Uso: node --env-file=.env.local scripts/tn-analisis.mjs
// No modifica nada (solo GET a TN + lecturas a Supabase).
import { createClient } from "@supabase/supabase-js";

const ORG = "a9695a41-4c61-4680-bfee-68a0c3af32a8"; // Bodysculpt
const UA = process.env.TIENDANUBE_USER_AGENT || "Spera (sistemabody@gmail.com)";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Token guardado.
const { data: cred } = await sb.from("tiendanube_credentials").select("store_id, access_token").eq("organization_id", ORG).maybeSingle();
if (!cred) { console.error("No hay token guardado. Corré primero tn-connect.mjs."); process.exit(1); }
const H = { Authentication: `bearer ${cred.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };

// Traer todos los productos de TN (paginado por Link header).
const tn = [];
let url = `https://api.tiendanube.com/v1/${cred.store_id}/products?fields=id,name,published,variants&per_page=200&page=1`;
let guard = 0;
while (url && guard++ < 200) {
  const r = await fetch(url, { headers: H });
  if (r.status === 404) break;
  if (!r.ok) { console.error("TN error", r.status, await r.text()); process.exit(1); }
  const page = await r.json();
  for (const p of page) {
    for (const v of p.variants ?? []) {
      tn.push({ pid: String(p.id), published: !!p.published, sku: v.sku ? String(v.sku).trim() : null, price: v.price != null ? Number(v.price) : null });
    }
  }
  const link = r.headers.get("link");
  const next = link?.split(",").find((s) => /rel="next"/.test(s));
  const m = next?.match(/<([^>]+)>/);
  url = m ? m[1] : null;
}
const tnProducts = new Set(tn.map((v) => v.pid));
const tnWithSku = tn.filter((v) => v.sku);
const tnBySku = new Map();
const seen = new Map();
for (const v of tnWithSku) { const k = v.sku.toLowerCase(); seen.set(k, (seen.get(k) ?? 0) + 1); if (!tnBySku.has(k)) tnBySku.set(k, v); }
const dupSku = [...seen.values()].filter((n) => n > 1).length;

// Spera.
async function all(table, sel, filt) {
  const out = []; for (let f = 0; ; f += 1000) { let q = sb.from(table).select(sel).range(f, f + 999); if (filt) q = filt(q); const { data } = await q; if (!data?.length) break; out.push(...data); if (data.length < 1000) break; } return out;
}
const { data: pl } = await sb.from("price_lists").select("id").eq("organization_id", ORG).eq("name", "Publico").maybeSingle();
const precio = new Map();
if (pl) for (const r of await all("price_list_items", "product_id, price", (q) => q.eq("price_list_id", pl.id).is("variant_id", null))) precio.set(r.product_id, Number(r.price));
const prod = new Map();
for (const r of await all("products", "id, lifecycle, active", (q) => q.eq("organization_id", ORG))) prod.set(r.id, { actual: r.lifecycle === "actual", active: !!r.active });
const vars = [];
for (const r of await all("product_variants", "id, sku, product_id")) { if (!prod.has(r.product_id)) continue; vars.push({ sku: r.sku ? String(r.sku).trim() : null, pid: r.product_id }); }
const speraBySku = new Map();
for (const v of vars) if (v.sku) { const k = v.sku.toLowerCase(); if (!speraBySku.has(k)) speraBySku.set(k, v); }

const matched = tnWithSku.filter((v) => speraBySku.has(v.sku.toLowerCase()));
const speraEnTN = vars.filter((v) => v.sku && tnBySku.has(v.sku.toLowerCase())).length;
const publicables = vars.filter((v) => { const p = prod.get(v.pid); return p?.actual && p?.active && precio.has(v.pid); });
const pubEnTN = publicables.filter((v) => v.sku && tnBySku.has(v.sku.toLowerCase())).length;
let priceDiff = 0; const ej = [];
for (const v of matched) { const sv = speraBySku.get(v.sku.toLowerCase()); const pu = precio.get(sv.pid); if (pu != null && v.price != null && Math.abs(pu - v.price) > 0.5) { priceDiff++; if (ej.length < 10) ej.push({ sku: v.sku, tn: v.price, spera: pu }); } }

const f = (n) => n.toLocaleString("es-AR");
console.log("\n===== RADIOGRAFÍA TIENDANUBE =====\n");
console.log("EN TIENDANUBE HOY:");
console.log(`  Productos: ${f(tnProducts.size)}`);
console.log(`  Variantes: ${f(tn.length)}  (con SKU: ${f(tnWithSku.length)}, sin SKU: ${f(tn.length - tnWithSku.length)})`);
console.log(`  Publicados: ${f(tn.filter((v) => v.published).length ? new Set(tn.filter((v) => v.published).map((v) => v.pid)).size : 0)} productos`);
console.log(`  SKU duplicados dentro de TN: ${f(dupSku)}`);
console.log("\nCRUCE POR SKU:");
console.log(`  En AMBOS (se adoptarían): ${f(matched.length)} variantes`);
console.log(`  Solo en TIENDANUBE (no se tocan): ${f(tn.length - matched.length)} variantes`);
console.log(`  Solo en SPERA: ${f(vars.filter((v) => v.sku).length - speraEnTN)} variantes`);
console.log("\nLO QUE SPERA PUBLICARÍA (actual + activo + con precio Público):");
console.log(`  Total publicables: ${f(publicables.length)}`);
console.log(`  Ya existen en TN (adoptar): ${f(pubEnTN)}`);
console.log(`  Serían ALTAS NUEVAS: ${f(publicables.length - pubEnTN)}`);
console.log("\nDIFERENCIAS DE PRECIO (en los que cruzan):");
console.log(`  Con precio distinto (TN vs Público Spera): ${f(priceDiff)}`);
for (const e of ej) console.log(`    ${e.sku}:  TN $${f(e.tn)}  →  Spera $${f(e.spera)}`);
console.log("\n==================================\n");
