// Migra las fotos de WooCommerce → Supabase Storage (bucket product-images).
//
//   node --env-file=.env.local scripts/import-woo-photos.mjs                 → VISTA PREVIA
//   node --env-file=.env.local scripts/import-woo-photos.mjs --commit --limit=10  → lote de prueba
//   node --env-file=.env.local scripts/import-woo-photos.mjs --commit        → TODO
//
// Copia (no mueve) las imágenes: los originales quedan intactos en Woo.
// Las fotos de Woo están a nivel producto → se importan como "General" (color null).
// Idempotente: saltea productos que YA tienen fotos en Spera.

import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

const CK = process.env.CK, CS = process.env.CS;
const WOO = "https://mayoristasbsvl.com.ar/wp-json/wc/v3";
const auth = "Basic " + Buffer.from(`${CK}:${CS}`).toString("base64");
const BUCKET = "product-images";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function woo(path, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(WOO + path, { headers: { Authorization: auth } });
      const t = await r.text();
      const idx = Math.min(...[t.indexOf("["), t.indexOf("{")].filter((x) => x >= 0));
      return JSON.parse(idx >= 0 ? t.slice(idx) : t);
    } catch (e) { if (i === tries - 1) throw e; await sleep(1000 * (i + 1)); }
  }
}
async function download(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === tries - 1) throw e; await sleep(700 * (i + 1)); }
  }
}
const CT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: org } = await sb.from("organizations").select("id").eq("name", "Bodysculpt").single();

// Mapa external_id (Woo) → product_id (Spera)
const idMap = new Map();
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from("products").select("id, external_id").eq("organization_id", org.id).not("external_id", "is", null).range(from, from + 999);
  if (!data || data.length === 0) break;
  for (const p of data) idMap.set(p.external_id, p.id);
  if (data.length < 1000) break;
}
// Productos que YA tienen fotos (para saltearlos)
const already = new Set();
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from("product_images").select("product_id").range(from, from + 999);
  if (!data || data.length === 0) break;
  for (const r of data) already.add(r.product_id);
  if (data.length < 1000) break;
}

console.log(COMMIT ? `\n### MIGRANDO FOTOS ${LIMIT === Infinity ? "TODO" : LIMIT} ###\n` : "\n### VISTA PREVIA (no se escribe nada) ###\n");

const stats = { productosConFoto: 0, fotosTotales: 0, migrados: 0, fotosSubidas: 0, saltados: 0, errores: [] };
let page = 1, processedWithPhotos = 0;

while (processedWithPhotos < LIMIT) {
  const arr = await woo(`/products?per_page=50&page=${page}&status=any&orderby=id&order=asc`);
  if (!Array.isArray(arr) || arr.length === 0) break;

  for (const p of arr) {
    const pid = idMap.get(String(p.id));
    const imgs = (p.images || []).filter((im) => im.src);
    if (!pid || imgs.length === 0) continue;

    stats.productosConFoto++;
    stats.fotosTotales += imgs.length;

    if (already.has(pid)) { stats.saltados++; continue; }
    if (processedWithPhotos >= LIMIT) break;
    processedWithPhotos++;

    if (!COMMIT) continue;

    let ok = 0;
    for (let idx = 0; idx < imgs.length; idx++) {
      const im = imgs[idx];
      const ext = (im.src.split("?")[0].split(".").pop() || "jpg").toLowerCase();
      const ct = CT[ext];
      if (!ct) { stats.errores.push({ producto: p.name, error: `formato .${ext} no soportado` }); continue; }
      try {
        const buf = await download(im.src);
        const path = `${org.id}/${pid}/woo-${im.id || idx}.${ext}`;
        const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true });
        if (upErr) { stats.errores.push({ producto: p.name, error: upErr.message }); continue; }
        const { error: insErr } = await sb.from("product_images").insert({
          organization_id: org.id, product_id: pid, path, color: null, position: idx, is_primary: idx === 0,
        });
        if (insErr) { stats.errores.push({ producto: p.name, error: insErr.message }); continue; }
        ok++; stats.fotosSubidas++;
      } catch (e) { stats.errores.push({ producto: p.name, error: String(e.message || e) }); }
      await sleep(80);
    }
    if (ok > 0) stats.migrados++;
    if (stats.migrados % 25 === 0 && stats.migrados > 0) console.log(`  … ${stats.migrados} productos con fotos migradas`);
  }
  page++;
}

console.log("\n=== RESUMEN ===");
console.log(JSON.stringify({
  productosConFotoEnWoo: stats.productosConFoto,
  fotosTotalesEnWoo: stats.fotosTotales,
  productosMigrados: stats.migrados,
  fotosSubidas: stats.fotosSubidas,
  saltadosPorYaTenerFotos: stats.saltados,
  errores: stats.errores.slice(0, 15),
  totalErrores: stats.errores.length,
}, null, 2));
console.log(COMMIT ? "\n✓ Migración de fotos terminada." : "\n(Vista previa — no se escribió nada.)");
