// Setea el stock FÍSICO de Mayorista-Central al valor del CSV (conteo absoluto).
// No toca 'reserved'. Match por SKU. El archivo trae las 16.661 variantes.
//   node --env-file=.env.local scripts/apply-stock-central.mjs "<csv>"            → vista previa
//   node --env-file=.env.local scripts/apply-stock-central.mjs "<csv>" --commit   → escribe
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const ORG = "a9695a41-4c61-4680-bfee-68a0c3af32a8";
const WH = "2398d79a-fbb4-4b58-8ac9-1b78f3207c77"; // Mayorista - Central
const CSV = process.argv[2];
const COMMIT = process.argv.includes("--commit");
if (!CSV) { console.error("Falta el path del CSV."); process.exit(1); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// CSV: SKU,Stock
const lines = readFileSync(CSV, "utf8").split(/\r?\n/).filter((l) => l.trim().length);
lines.shift();
const want = new Map();
for (const l of lines) { const i = l.indexOf(","); const sku = l.slice(0, i).trim().toLowerCase(); const n = parseInt(l.slice(i + 1).trim(), 10); if (Number.isFinite(n)) want.set(sku, Math.max(0, n)); }
console.log("Filas válidas en CSV:", want.size);

// sku -> variant_id
const skuToVar = new Map();
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("product_variants").select("id, sku").eq("organization_id", ORG).not("sku", "is", null).range(from, from + 999);
  if (error) { console.error("variants:", error.message); process.exit(1); }
  if (!data.length) break;
  for (const v of data) skuToVar.set(String(v.sku).trim().toLowerCase(), v.id);
  if (data.length < 1000) break;
}

const upserts = []; let noMatch = 0;
for (const [sku, qty] of want) { const vid = skuToVar.get(sku); if (!vid) { noMatch++; continue; } upserts.push({ organization_id: ORG, warehouse_id: WH, variant_id: vid, quantity: qty }); }
console.log(`A escribir: ${upserts.length} | sin match (se ignoran): ${noMatch}`);
if (!COMMIT) { console.log("\n(vista previa — corré con --commit para escribir)"); process.exit(0); }

let done = 0;
for (let i = 0; i < upserts.length; i += 500) {
  const { error } = await sb.from("stock").upsert(upserts.slice(i, i + 500), { onConflict: "warehouse_id,variant_id" });
  if (error) { console.error("upsert:", error.message); process.exit(1); }
  done += Math.min(500, upserts.length - i);
  if (done % 2500 === 0 || done === upserts.length) console.log(`  ${done}/${upserts.length}`);
}
console.log("✓ Stock de Mayorista-Central actualizado:", done);
