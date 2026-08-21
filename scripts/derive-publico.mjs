// Deriva la lista Publico = round(Mayorista * 2) a nivel producto.
// Usa org.id explícito (current_org_id/recalc_all_pricing dependen de auth.uid,
// que no existe en service-role ni en el SQL Editor).
//   node --env-file=.env.local scripts/derive-publico.mjs

import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: org } = await sb.from("organizations").select("id").eq("name", "Bodysculpt").single();
const { data: may } = await sb.from("price_lists").select("id").eq("organization_id", org.id).eq("name", "Mayorista").single();
const { data: pub } = await sb.from("price_lists").select("id").eq("organization_id", org.id).eq("name", "Publico").single();
if (!may || !pub) { console.log("Faltan listas Mayorista/Publico."); process.exit(1); }

// Leo todos los precios Mayorista a nivel producto.
const base = [];
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from("price_list_items").select("product_id, price")
    .eq("organization_id", org.id).eq("price_list_id", may.id).is("variant_id", null).range(from, from + 999);
  if (!data || data.length === 0) break;
  base.push(...data);
  if (data.length < 1000) break;
}
console.log(`Mayorista a nivel producto: ${base.length}`);

// Reemplazo el Publico derivado.
await sb.from("price_list_items").delete().eq("organization_id", org.id).eq("price_list_id", pub.id).is("variant_id", null);

const rows = base.map((r) => ({ organization_id: org.id, price_list_id: pub.id, product_id: r.product_id, variant_id: null, price: Math.round(Number(r.price) * 2) }));
let inserted = 0;
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await sb.from("price_list_items").insert(rows.slice(i, i + 500));
  if (error) { console.error("ERR insert:", error.message); process.exit(1); }
  inserted += Math.min(500, rows.length - i);
}
console.log(`✓ Publico derivado (= Mayorista x2): ${inserted} productos.`);
