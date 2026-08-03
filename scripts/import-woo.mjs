// Importador de catálogo desde WooCommerce → Spera.
//
// Uso (desde la carpeta del proyecto):
//   node --env-file=.env.local scripts/import-woo.mjs                  → VISTA PREVIA (no escribe)
//   node --env-file=.env.local scripts/import-woo.mjs --commit --limit=20  → importa 20 (lote de prueba)
//   node --env-file=.env.local scripts/import-woo.mjs --commit         → importa TODO
//   node --env-file=.env.local scripts/import-woo.mjs --fix            → repara productos sin variantes
//
// Requiere env: CK y CS (llaves de Woo), y NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Respeta el SKU de Woo. NO importa precios ni stock. Idempotente vía external_id.

import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const FIX = process.argv.includes("--fix");
const PRICES = process.argv.includes("--prices");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

const CK = process.env.CK, CS = process.env.CS;
const WOO = "https://mayoristasbsvl.com.ar/wp-json/wc/v3";
const auth = "Basic " + Buffer.from(`${CK}:${CS}`).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function woo(path, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(WOO + path, { headers: { Authorization: auth } });
      const t = await r.text();
      const idx = Math.min(...[t.indexOf("["), t.indexOf("{")].filter((x) => x >= 0));
      return JSON.parse(idx >= 0 ? t.slice(idx) : t);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

const decode = (s = "") =>
  s.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
const stripHtml = (s = "") => decode(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();

function variationType(p) {
  if (p.type !== "variable") return "none";
  const names = (p.attributes || []).map((a) => a.name);
  const hasColor = names.includes("Color");
  const hasSize = names.includes("Talle") || names.includes("Tamaño");
  if (hasColor && hasSize) return "size_color";
  if (hasSize) return "size";
  if (hasColor) return "color";
  if (names.length > 0) return "color";
  return "none";
}
const attrVal = (v, wanted) => {
  const a = (v.attributes || []).find((x) => wanted.includes(x.name));
  return a ? decode(a.option) : null;
};

// Construye las variantes de un producto (size = talle; color = resto de atributos).
// Garantiza combinaciones únicas dentro del producto para no perder ninguna variante/SKU.
async function buildVariants(p) {
  if (p.type !== "variable") {
    return [{ external_id: `${p.id}-s`, size: null, color: null, sku: (p.sku || "").trim() || null }];
  }
  const vs = await woo(`/products/${p.id}/variations?per_page=100`);
  const used = new Set();
  const out = [];
  for (const v of vs || []) {
    const size = attrVal(v, ["Talle", "Tamaño"]);
    const others = (v.attributes || [])
      .filter((a) => !["Talle", "Tamaño"].includes(a.name))
      .map((a) => decode(a.option))
      .filter(Boolean);
    let color = others.join(" / ") || null;
    let combo = `${size || ""}|${color || ""}`;
    if (used.has(combo)) {
      let n = 2;
      while (used.has(`${size || ""}|${(color || "") + " (" + n + ")"}`)) n++;
      color = (color || "") + " (" + n + ")";
      combo = `${size || ""}|${color}`;
    }
    used.add(combo);
    out.push({ external_id: String(v.id), size, color, sku: (v.sku || "").trim() || null });
  }
  await sleep(150);
  return out;
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: org } = await sb.from("organizations").select("id").eq("name", "Bodysculpt").single();
const { data: cats } = await sb.from("categories").select("id, name");
const catMap = new Map((cats ?? []).map((c) => [c.name.toLowerCase(), c.id]));

async function getCategoryId(catName) {
  if (!catName) return null;
  const key = catName.toLowerCase();
  if (catMap.has(key)) return catMap.get(key);
  if (!COMMIT) return null;
  const { data } = await sb
    .from("categories")
    .upsert({ organization_id: org.id, name: catName }, { onConflict: "organization_id,name" })
    .select("id").single();
  if (data) { catMap.set(key, data.id); return data.id; }
  return null;
}

const variantRows = (productId, variants) =>
  variants.map((v) => ({
    organization_id: org.id, product_id: productId, external_id: v.external_id,
    size: v.size, color: v.color, sku: v.sku, barcode: v.sku, active: true,
  }));

// ── Modo reparación: solo productos importados que quedaron sin variantes ──
if (FIX) {
  const { data } = await sb
    .from("products")
    .select("id, external_id, name, product_variants(count)")
    .eq("external_source", "woocommerce");
  const broken = (data || []).filter((p) => (p.product_variants?.[0]?.count ?? 0) === 0 && p.external_id);
  console.log(`### REPARANDO ${broken.length} productos sin variantes ###\n`);
  let fixed = 0;
  const errs = [];
  for (const bp of broken) {
    const p = await woo(`/products/${bp.external_id}`);
    if (!p || !p.id) { errs.push({ producto: bp.name, error: "no encontrado en Woo" }); continue; }
    const variants = await buildVariants(p);
    const { error } = await sb.from("product_variants").upsert(variantRows(bp.id, variants), { onConflict: "organization_id,external_id" });
    if (error) errs.push({ producto: bp.name, error: error.message });
    else { fixed++; console.log(`  ✓ ${p.name} (${variants.length} variantes)`); }
  }
  console.log(`\nReparados: ${fixed}/${broken.length}. Errores: ${errs.length}`);
  if (errs.length) console.log(JSON.stringify(errs, null, 2));
  process.exit(0);
}

// ── Modo precios: carga el precio de Woo en la lista Mayorista (precio por producto) ──
if (PRICES) {
  const { data: pl } = await sb.from("price_lists").select("id").eq("organization_id", org.id).eq("name", "Mayorista").single();
  if (!pl) { console.log("No existe la lista 'Mayorista'."); process.exit(1); }

  const idMap = new Map();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("products").select("id, external_id")
      .eq("organization_id", org.id).not("external_id", "is", null).range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const p of data) idMap.set(p.external_id, p.id);
    if (data.length < 1000) break;
  }
  console.log(`### PRECIOS → Mayorista (${idMap.size} productos mapeados) ###\n`);

  // Limpio precios de producto (variant_id null) de esa lista para que sea re-ejecutable.
  await sb.from("price_list_items").delete().eq("organization_id", org.id).eq("price_list_id", pl.id).is("variant_id", null);

  let rows = [], withPrice = 0, noPrice = 0, processed = 0, page = 1;
  const flush = async () => {
    if (!rows.length) return;
    const { error } = await sb.from("price_list_items").insert(rows);
    if (error) console.log("ERR insert:", error.message);
    rows = [];
  };
  while (true) {
    const arr = await woo(`/products?per_page=50&page=${page}&status=any&orderby=id&order=asc`);
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const p of arr) {
      processed++;
      const pid = idMap.get(String(p.id));
      if (!pid) continue;
      let price = parseFloat(p.price || p.regular_price || "");
      if ((!price || isNaN(price)) && p.type === "variable") {
        const vs = await woo(`/products/${p.id}/variations?per_page=100`);
        const found = (vs || []).map((v) => v.regular_price || v.price).find(Boolean);
        price = found ? parseFloat(found) : NaN;
        await sleep(120);
      }
      if (!price || isNaN(price)) { noPrice++; continue; }
      rows.push({ organization_id: org.id, price_list_id: pl.id, product_id: pid, variant_id: null, price });
      withPrice++;
      if (rows.length >= 500) await flush();
      if (processed % 300 === 0) console.log(`  … ${processed} procesados`);
    }
    page++;
  }
  await flush();
  console.log(`\n✓ Precios Mayorista cargados: ${withPrice}. Sin precio en Woo: ${noPrice}.`);
  process.exit(0);
}

console.log(COMMIT ? `\n### IMPORTANDO ${LIMIT === Infinity ? "TODO" : LIMIT} ###\n` : "\n### VISTA PREVIA (no se escribe nada) ###\n");

const stats = { productos: 0, variantes: 0, porTipo: {}, categoriasCreadas: new Set(), sinCategoria: 0, errores: [] };
let processed = 0, page = 1;

while (processed < LIMIT) {
  const arr = await woo(`/products?per_page=50&page=${page}&status=any&orderby=id&order=asc`);
  if (!Array.isArray(arr) || arr.length === 0) break;

  for (const p of arr) {
    if (processed >= LIMIT) break;
    processed++;
    const vtype = variationType(p);
    stats.productos++;
    stats.porTipo[vtype] = (stats.porTipo[vtype] || 0) + 1;

    const catName = (p.categories || [])[0]?.name ? decode(p.categories[0].name) : null;
    const had = catName ? catMap.has(catName.toLowerCase()) : false;
    const catId = await getCategoryId(catName);
    if (!catId) stats.sinCategoria++;
    else if (catName && !had) stats.categoriasCreadas.add(catName);

    if (!COMMIT) {
      stats.variantes += p.type === "variable" ? (p.variations || []).length : 1;
      continue;
    }

    const variants = await buildVariants(p);
    stats.variantes += variants.length;

    const { data: prod, error: pe } = await sb
      .from("products")
      .upsert(
        {
          organization_id: org.id, external_id: String(p.id), external_source: "woocommerce",
          name: decode(p.name), description: stripHtml(p.description) || null, category_id: catId,
          variation_type: vtype, brand: "Bodysculpt", tax_rate: 21, active: p.status === "publish",
        },
        { onConflict: "organization_id,external_id" }
      )
      .select("id").single();
    if (pe) { stats.errores.push({ producto: p.name, error: pe.message }); continue; }

    const { error: ve } = await sb.from("product_variants").upsert(variantRows(prod.id, variants), { onConflict: "organization_id,external_id" });
    if (ve) stats.errores.push({ producto: p.name, error: ve.message });

    if (stats.productos % 100 === 0) console.log(`  … ${stats.productos} productos procesados`);
  }
  page++;
}

console.log("\n=== RESUMEN ===");
console.log(JSON.stringify({
  productos: stats.productos, variantes: stats.variantes, porTipo: stats.porTipo,
  categoriasCreadas: [...stats.categoriasCreadas], productosSinCategoria: stats.sinCategoria,
  errores: stats.errores.slice(0, 15), totalErrores: stats.errores.length,
}, null, 2));
console.log(COMMIT ? "\n✓ Importación terminada." : "\n(Vista previa — no se escribió nada. Corré con --commit para importar.)");
