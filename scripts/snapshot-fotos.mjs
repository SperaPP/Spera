// Snapshot del mapeo foto → producto (por external_id de Woo + SKUs), ANTES del wipe.
// Los archivos del bucket no se tocan; solo se guarda a quién pertenece cada uno,
// para re-vincular después de la reimportación sin re-subir nada.
//   node --env-file=.env.local scripts/snapshot-fotos.mjs
// Escribe scripts/fotos-snapshot.json
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const ORG = "a9695a41-4c61-4680-bfee-68a0c3af32a8";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function all(table, sel, filt) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    let q = sb.from(table).select(sel).range(f, f + 999);
    if (filt) q = filt(q);
    const { data, error } = await q;
    if (error) { console.error(table, error.message); process.exit(1); }
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// Productos: id → external_id + name.
const prods = await all("products", "id, external_id, name", (q) => q.eq("organization_id", ORG));
const prodById = new Map(prods.map((p) => [p.id, { external_id: p.external_id, name: p.name }]));

// Variantes: product_id → [skus].
const skusByProduct = new Map();
for (const v of await all("product_variants", "product_id, sku")) {
  if (!v.sku) continue;
  if (!skusByProduct.has(v.product_id)) skusByProduct.set(v.product_id, []);
  skusByProduct.get(v.product_id).push(String(v.sku).trim());
}

// Fotos.
const imgs = await all("product_images", "path, color, is_primary, product_id");
const snapshot = imgs.map((im) => {
  const p = prodById.get(im.product_id) ?? {};
  return {
    path: im.path,
    color: im.color,
    is_primary: im.is_primary,
    external_id: p.external_id ?? null,
    name: p.name ?? null,
    skus: skusByProduct.get(im.product_id) ?? [],
  };
});

const sinExternal = snapshot.filter((s) => !s.external_id).length;
const sinSku = snapshot.filter((s) => s.skus.length === 0).length;

writeFileSync("scripts/fotos-snapshot.json", JSON.stringify(snapshot));
console.log(`✓ Snapshot: ${snapshot.length} fotos guardadas en scripts/fotos-snapshot.json`);
console.log(`  productos distintos: ${new Set(imgs.map((i) => i.product_id)).size}`);
console.log(`  sin external_id: ${sinExternal}   sin SKU: ${sinSku}`);
