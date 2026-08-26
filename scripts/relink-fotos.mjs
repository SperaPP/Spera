// Re-vincula las fotos (del snapshot) a los productos recién importados, por SKU.
// No re-sube nada: recrea las filas product_images apuntando a los archivos que
// ya están en el bucket. Correr DESPUÉS de importar los productos.
//   node --env-file=.env.local scripts/relink-fotos.mjs            → vista previa
//   node --env-file=.env.local scripts/relink-fotos.mjs --commit   → escribe
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const ORG = "a9695a41-4c61-4680-bfee-68a0c3af32a8"; // Bodysculpt
const COMMIT = process.argv.includes("--commit");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const snap = JSON.parse(readFileSync("scripts/fotos-snapshot.json", "utf8"));

// SKU → product_id de los productos actuales.
const skuToProd = new Map();
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("product_variants").select("sku, product_id").not("sku", "is", null).range(from, from + 999);
  if (error) { console.error("variants:", error.message); process.exit(1); }
  if (!data.length) break;
  for (const v of data) if (v.sku) skuToProd.set(String(v.sku).trim().toLowerCase(), v.product_id);
  if (data.length < 1000) break;
}
console.log("variantes con SKU en el sistema:", skuToProd.size);

// Paths ya existentes (para no duplicar si se corre de nuevo).
const existing = new Set();
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from("product_images").select("path").range(from, from + 999);
  if (!data || !data.length) break;
  for (const r of data) existing.add(r.path);
  if (data.length < 1000) break;
}

const rows = []; let sinProducto = 0, yaExiste = 0;
for (const f of snap) {
  if (existing.has(f.path)) { yaExiste++; continue; }
  let pid = null;
  for (const s of (f.skus || [])) { pid = skuToProd.get(String(s).trim().toLowerCase()); if (pid) break; }
  if (!pid) { sinProducto++; continue; }
  rows.push({ organization_id: ORG, product_id: pid, path: f.path, color: f.color ?? null, is_primary: !!f.is_primary });
}

console.log(`A re-vincular: ${rows.length} fotos | ya existían: ${yaExiste} | sin producto (SKU no encontrado): ${sinProducto}`);
if (!COMMIT) { console.log("\n(vista previa — corré con --commit para escribir)"); process.exit(0); }

let done = 0;
for (let i = 0; i < rows.length; i += 1000) {
  const { error } = await sb.from("product_images").insert(rows.slice(i, i + 1000));
  if (error) { console.error("insert:", error.message); process.exit(1); }
  done += Math.min(1000, rows.length - i);
  console.log(`  ${done}/${rows.length}`);
}
console.log("✓ Fotos re-vinculadas:", done);
