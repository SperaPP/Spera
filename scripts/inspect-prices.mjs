// Inspección de SOLO LECTURA del estado de precios/perfiles.
//   node --env-file=.env.local scripts/inspect-prices.mjs
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: lists } = await sb.from("price_lists").select("id, name, active");
console.log("\n=== price_lists ===");
for (const l of lists ?? []) {
  const { count } = await sb.from("price_list_items").select("*", { count: "exact", head: true }).eq("price_list_id", l.id);
  console.log(`  ${l.name}  (active=${l.active})  items=${count}`);
}

const { data: types } = await sb.from("customer_types").select("id, name, price_list_id, default_fiscal_condition, active");
console.log("\n=== customer_types ===");
const listName = Object.fromEntries((lists ?? []).map((l) => [l.id, l.name]));
for (const t of types ?? []) {
  console.log(`  ${t.name}  → lista=${listName[t.price_list_id] ?? "—"}  (fiscal=${t.default_fiscal_condition}, active=${t.active})`);
}

const { count: catCount } = await sb.from("categories").select("*", { count: "exact", head: true });
console.log(`\n=== categories: ${catCount} ===`);

// Muestra 3 productos con su(s) precio(s) a nivel producto.
const { data: sample } = await sb
  .from("price_list_items")
  .select("product_id, price, price_list_id, products(name), price_lists(name)")
  .is("variant_id", null)
  .limit(8);
console.log("\n=== muestra de price_list_items (product-level) ===");
for (const r of sample ?? []) {
  const pn = Array.isArray(r.products) ? r.products[0]?.name : r.products?.name;
  const ln = Array.isArray(r.price_lists) ? r.price_lists[0]?.name : r.price_lists?.name;
  console.log(`  ${ln}: $${r.price}  — ${pn}`);
}

// ¿Hay precios a nivel variante?
const { count: variantPrices } = await sb.from("price_list_items").select("*", { count: "exact", head: true }).not("variant_id", "is", null);
console.log(`\nprice_list_items a nivel VARIANTE: ${variantPrices}`);
