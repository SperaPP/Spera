// Publica un producto NUEVO en Tiendanube (lo crea con sus variantes, precio Público,
// stock disponible e imágenes) y guarda los tiendanube_links. Match de variante por SKU.
//   node --env-file=.env.local scripts/tn-publish.mjs "<nombre o id>"            → preview
//   node --env-file=.env.local scripts/tn-publish.mjs "<nombre o id>" --commit   → publica
import { createClient } from "@supabase/supabase-js";

const ORG = "a9695a41-4c61-4680-bfee-68a0c3af32a8";
const WH = "2398d79a-fbb4-4b58-8ac9-1b78f3207c77"; // Mayorista - Central
const UA = process.env.TIENDANUBE_USER_AGENT || "Spera (sistemabody@gmail.com)";
const COMMIT = process.argv.includes("--commit");
const arg = process.argv[2];
const BUCKET = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images`;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: cred } = await sb.from("tiendanube_credentials").select("store_id, access_token").eq("organization_id", ORG).maybeSingle();
if (!cred) { console.error("Sin token TN."); process.exit(1); }
const BASE = `https://api.tiendanube.com/v1/${cred.store_id}`;
const H = { Authentication: `bearer ${cred.access_token}`, "User-Agent": UA, "Content-Type": "application/json" };

// Producto
const isUuid = /^[0-9a-f-]{36}$/.test(arg);
let q = sb.from("products").select("id, name, variation_type, tn_sync").eq("organization_id", ORG);
q = isUuid ? q.eq("id", arg) : q.ilike("name", arg);
const { data: prod } = await q.maybeSingle();
if (!prod) { console.error("Producto no encontrado:", arg); process.exit(1); }

// Variantes activas
const { data: vars } = await sb.from("product_variants").select("id, sku, size, color, active").eq("product_id", prod.id).eq("active", true);
const active = (vars || []).filter((v) => v.sku);
if (!active.length) { console.error("Sin variantes activas con SKU."); process.exit(1); }

// Ya vinculado?
const { count: yaLinks } = await sb.from("tiendanube_links").select("*", { count: "exact", head: true }).in("variant_id", active.map((v) => v.id));
if (yaLinks) { console.error(`Ya tiene ${yaLinks} vínculo(s) con TN (ya publicado/adoptado). Abortando.`); process.exit(1); }

// Precio Público
const { data: pubList } = await sb.from("price_lists").select("id").eq("organization_id", ORG).eq("name", "Publico").maybeSingle();
const { data: pl } = await sb.from("price_list_items").select("price").eq("price_list_id", pubList.id).eq("product_id", prod.id).is("variant_id", null).maybeSingle();
if (!pl) { console.error("Sin precio Público. Cargá el precio antes de publicar."); process.exit(1); }
const precio = Number(pl.price).toFixed(2);

// Stock disponible por variante
const { data: st } = await sb.from("stock").select("variant_id, quantity, reserved").eq("warehouse_id", WH).in("variant_id", active.map((v) => v.id));
const disp = new Map((st || []).map((s) => [s.variant_id, Math.max(0, Number(s.quantity) - Number(s.reserved ?? 0))]));

// Imágenes
const { data: imgs } = await sb.from("product_images").select("path, is_primary").eq("product_id", prod.id).order("is_primary", { ascending: false }).limit(9);

// Armar payload según variation_type
const vt = prod.variation_type;
const hasSize = vt === "size" || vt === "size_color";
const hasColor = vt === "color" || vt === "size_color";
const attributes = [];
if (hasSize) attributes.push({ es: "Talle" });
if (hasColor) attributes.push({ es: "Color" });

const variants = active.map((v) => {
  const values = [];
  if (hasSize) values.push({ es: v.size || "Único" });
  if (hasColor) values.push({ es: v.color || "Único" });
  const out = { price: precio, stock: disp.get(v.id) ?? 0, stock_management: true, sku: String(v.sku) };
  if (values.length) out.values = values;
  return out;
});

const payload = {
  name: { es: prod.name },
  published: true,
  ...(attributes.length ? { attributes } : {}),
  variants,
  ...(imgs && imgs.length ? { images: imgs.map((im) => ({ src: `${BUCKET}/${im.path}` })) } : {}),
};

console.log(`Producto: "${prod.name}" (${vt}) | precio Público $${precio} | ${variants.length} variantes | ${imgs?.length || 0} imágenes`);
console.log("Payload:", JSON.stringify(payload, null, 2).slice(0, 1200));
if (!COMMIT) { console.log("\n(preview — corré con --commit para publicar en la tienda)"); process.exit(0); }

// Crear en TN
const r = await fetch(`${BASE}/products`, { method: "POST", headers: H, body: JSON.stringify(payload) });
const body = await r.json();
if (!r.ok) { console.error("TN error", r.status, JSON.stringify(body).slice(0, 400)); process.exit(1); }
console.log("✓ Producto creado en TN, id:", body.id, "| variantes devueltas:", (body.variants || []).length);

// Guardar links por SKU
const tnBySku = new Map((body.variants || []).map((v) => [String(v.sku).trim().toLowerCase(), v.id]));
const links = [];
for (const v of active) {
  const tnv = tnBySku.get(String(v.sku).trim().toLowerCase());
  if (tnv) links.push({ organization_id: ORG, variant_id: v.id, tn_product_id: String(body.id), tn_variant_id: String(tnv), last_synced_at: new Date().toISOString() });
}
if (links.length) {
  const { error } = await sb.from("tiendanube_links").upsert(links, { onConflict: "organization_id,variant_id" });
  if (error) console.error("links:", error.message);
}
console.log(`✓ Vínculos guardados: ${links.length}/${active.length}`);
console.log(`Ver en la tienda: https://${cred.store_id === "4295048" ? "bodysculpt7.mitiendanube.com" : "tu-tienda"}/productos/${body.id}`);
