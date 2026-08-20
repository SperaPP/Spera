// Vacía el bucket de fotos (product-images) por la Storage API.
// Supabase no permite borrar storage.objects por SQL, por eso va aparte.
//
//   node --env-file=.env.local scripts/wipe-photos.mjs            → VISTA PREVIA (cuenta, no borra)
//   node --env-file=.env.local scripts/wipe-photos.mjs --commit   → BORRA TODO el bucket
//
// ⚠️ Destructivo. Corré esto junto con scripts/wipe-data.sql para el reset total.

import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const BUCKET = "product-images";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Lista recursiva: las carpetas vienen con id null; los archivos con id.
async function walk(prefix) {
  let files = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) files = files.concat(await walk(path)); // carpeta
      else files.push(path);
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return files;
}

const files = await walk("");
console.log(`Archivos en el bucket "${BUCKET}": ${files.length}`);

if (!COMMIT) {
  console.log("\n### VISTA PREVIA — no se borró nada. Corré con --commit para borrar. ###");
  process.exit(0);
}

let removed = 0;
for (let i = 0; i < files.length; i += 200) {
  const chunk = files.slice(i, i + 200);
  const { error } = await sb.storage.from(BUCKET).remove(chunk);
  if (error) { console.error("Error borrando lote:", error.message); process.exit(1); }
  removed += chunk.length;
  console.log(`  borrados ${removed}/${files.length}`);
}
console.log(`\n✓ Bucket vaciado: ${removed} archivos.`);
