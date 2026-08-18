// Verificación SOLO LECTURA de los precios derivados tras inicializar.
//   node --env-file=.env.local scripts/verify-prices.mjs
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: lists } = await sb.from("price_lists").select("id, name");
const L = Object.fromEntries((lists ?? []).map((l) => [l.name, l.id]));
const lp = L["Platinum"], lpub = L["Publico"], lmay = L["Mayorista"];

async function count(listId) {
  const { count } = await sb.from("price_list_items").select("*", { count: "exact", head: true }).eq("price_list_id", listId).is("variant_id", null);
  return count;
}
console.log("=== conteo por lista (nivel producto) ===");
console.log(`  Platinum:  ${await count(lp)}`);
console.log(`  Publico:   ${await count(lpub)}`);
console.log(`  Mayorista: ${await count(lmay)}`);

// Reglas configuradas
const { data: rules } = await sb.from("pricing_rules").select("category_id, publico_markup_pct, mayorista_discount_pct, categories(name)");
console.log("\n=== reglas ===");
for (const r of rules ?? []) {
  const cn = r.category_id ? (Array.isArray(r.categories) ? r.categories[0]?.name : r.categories?.name) : "· GENERAL ·";
  console.log(`  ${cn}: +${r.publico_markup_pct}% / -${r.mayorista_discount_pct}%`);
}

// Muestra: junta las 3 listas por producto para 12 productos.
const { data: plats } = await sb
  .from("price_list_items")
  .select("product_id, price, products(name, category_id, categories(name))")
  .eq("price_list_id", lp).is("variant_id", null).limit(12);

const ids = (plats ?? []).map((r) => r.product_id);
const { data: pubs } = await sb.from("price_list_items").select("product_id, price").eq("price_list_id", lpub).is("variant_id", null).in("product_id", ids);
const { data: mays } = await sb.from("price_list_items").select("product_id, price").eq("price_list_id", lmay).is("variant_id", null).in("product_id", ids);
const pubMap = Object.fromEntries((pubs ?? []).map((r) => [r.product_id, Number(r.price)]));
const mayMap = Object.fromEntries((mays ?? []).map((r) => [r.product_id, Number(r.price)]));

console.log("\n=== muestra (Platinum → Publico → Mayorista) ===");
for (const r of plats ?? []) {
  const prod = Array.isArray(r.products) ? r.products[0] : r.products;
  const cat = prod?.categories ? (Array.isArray(prod.categories) ? prod.categories[0]?.name : prod.categories?.name) : "—";
  const plat = Number(r.price), pub = pubMap[r.product_id], may = mayMap[r.product_id];
  const ratioPub = pub && plat ? (pub / plat).toFixed(2) : "?";
  const ratioMay = may && pub ? (may / pub).toFixed(2) : "?";
  console.log(`  [${cat}] Plat $${plat} → Pub $${pub} (x${ratioPub}) → May $${may} (x${ratioMay})  ${prod?.name ?? ""}`);
}
