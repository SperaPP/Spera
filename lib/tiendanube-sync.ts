// Sincronización de PRODUCTOS Spera → Tiendanube (variantes, SKU, fotos, precio SALE).
// Complementa al sync de stock (lib/tiendanube.ts), que solo empuja cantidades.
//
// Reglas (validadas con el dueño, 27/10/2026):
//  · Vincular SIN DUPLICAR: por vínculo existente → por SKU → por talle/color dentro del
//    mismo producto (solo si el match es inequívoco). Al vincular por talle/color se le
//    escribe en TN el SKU de Spera, así queda atado por SKU para siempre.
//  · Nunca se mueve un vínculo existente a otro producto de TN, ni se le "roba" a TN un
//    SKU que pertenece a otra variante de Spera.
//  · Talles/colores que existen en Spera y no en TN → se crean en el producto de TN.
//  · Fotos: solo se AGREGAN las que faltan (nunca se borra una foto de TN). Si el producto
//    ya tenía fotos en TN y nunca se sincronizó, las actuales de Spera se toman como base
//    (no se suben repetidas); de ahí en más, toda foto nueva de Spera se sube.
//  · Precio: solo para SALE → precio de lista Público (tachado) + promo Público (rebajado).
//    Sin promo Público → solo precio de lista, sin rebaja.
//  · Productos SALE que no existen en TN → se crean OCULTOS (published=false).
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTNCreds, tnFetch, type TNCreds, type TNProductLite } from "@/lib/tiendanube";

type Admin = ReturnType<typeof createAdminClient>;

export type SyncCtx = {
  orgId: string;
  creds: TNCreds;
  admin: Admin;
  wh: string;                    // depósito del local Tiendanube (Mayorista - Central)
  pubListId: string;
  saleCategoryId: string | null; // categoría "SALE" de TN (para los que se crean)
  imgTable: boolean;             // existe tn_image_links (migración 0121)
};

export type ItemResult = {
  productId: string;
  name: string;
  action: "creado" | "actualizado" | "omitido" | "error";
  tnProductId?: string;
  vinculadas?: number;
  variantesCreadas?: number;
  fotosSubidas?: number;
  precios?: number;
  notas: string[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAUSE = 220; // entre escrituras a TN (rate limit ~2 req/s)

/** Normaliza texto para comparar nombres y valores de variante. */
export function norm(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
/** Valor de talle/color normalizado; vacío y "único/TU" son lo mismo. */
function normVal(s: unknown): string {
  const n = norm(s);
  return n === "" || n === "unico" || n === "u" || n === "tu" || n === "talle unico" ? "unico" : n;
}
const skuKey = (s: unknown) => String(s ?? "").trim().toLowerCase();

export async function buildCtx(orgId: string): Promise<SyncCtx | { error: string }> {
  const admin = createAdminClient();
  const creds = await getTNCreds(orgId);
  if (!creds) return { error: "Tiendanube no está conectado" };
  const { data: store } = await admin.from("stores").select("warehouse_id").eq("organization_id", orgId).eq("name", "Tiendanube").maybeSingle();
  if (!store?.warehouse_id) return { error: "No existe el local Tiendanube" };
  const { data: pub } = await admin.from("price_lists").select("id").eq("organization_id", orgId).eq("name", "Publico").maybeSingle();
  if (!pub) return { error: "No existe la lista Publico" };
  // OJO: con head:true PostgREST responde 204 aunque la tabla NO exista → select normal.
  const { error: imgErr } = await admin.from("tn_image_links").select("id").limit(1);

  let saleCategoryId: string | null = null;
  const res = await tnFetch(creds, "/categories?fields=id,name&per_page=200");
  if (res.ok) {
    const cats = (await res.json()) as { id: number; name: Record<string, string> }[];
    const sale = cats.find((c) => norm(Object.values(c.name ?? {})[0]) === "sale");
    saleCategoryId = sale ? String(sale.id) : null;
  }
  return { orgId, creds, admin, wh: store.warehouse_id as string, pubListId: pub.id as string, saleCategoryId, imgTable: !imgErr };
}

// ── Lectura ───────────────────────────────────────────────────────────────────

type TNVar = { id: string; values: string[]; sku: string | null; price: string | null; promo: string | null };
type TNProd = { id: string; name: string; attributes: string[]; variants: TNVar[]; images: { id: string }[] };

function parseTNProduct(raw: Record<string, unknown>): TNProd {
  const first = (o: unknown) => (o && typeof o === "object" ? String(Object.values(o as Record<string, string>)[0] ?? "") : String(o ?? ""));
  return {
    id: String(raw.id),
    name: first(raw.name),
    attributes: ((raw.attributes ?? []) as unknown[]).map(first),
    variants: ((raw.variants ?? []) as Record<string, unknown>[]).map((v) => ({
      id: String(v.id),
      values: ((v.values ?? []) as unknown[]).map(first),
      sku: v.sku != null && String(v.sku).trim() !== "" ? String(v.sku).trim() : null,
      price: v.price != null ? String(v.price) : null,
      promo: v.promotional_price != null ? String(v.promotional_price) : null,
    })),
    images: ((raw.images ?? []) as Record<string, unknown>[]).map((i) => ({ id: String(i.id) })),
  };
}

async function getTNProduct(ctx: SyncCtx, id: string): Promise<TNProd | null> {
  const res = await tnFetch(ctx.creds, `/products/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TN ${res.status} al leer el producto ${id}`);
  return parseTNProduct((await res.json()) as Record<string, unknown>);
}

/** Producto de TN que contiene ese SKU (o null). Red de seguridad anti-duplicado. */
async function findTNProductBySku(ctx: SyncCtx, sku: string): Promise<string | null> {
  const res = await tnFetch(ctx.creds, `/products/sku/${encodeURIComponent(sku)}`);
  if (!res.ok) return null;
  const p = (await res.json()) as { id?: number | string };
  return p?.id != null ? String(p.id) : null;
}

type SpVar = { id: string; sku: string; size: string | null; color: string | null };
type SpProd = {
  id: string; name: string; variationType: string;
  variants: SpVar[];
  disp: Map<string, number>;
  pub: { price: number; promo: number | null } | null;
  images: { id: string; path: string }[];
};

async function loadSpera(ctx: SyncCtx, productId: string): Promise<SpProd | null> {
  const { admin, orgId } = ctx;
  const { data: p } = await admin.from("products").select("id, name, variation_type").eq("id", productId).eq("organization_id", orgId).maybeSingle();
  if (!p) return null;
  const { data: vs } = await admin.from("product_variants").select("id, sku, size, color").eq("product_id", productId).eq("active", true).not("sku", "is", null);
  const variants = (vs ?? []).filter((v) => String(v.sku).trim() !== "")
    .map((v) => ({ id: v.id as string, sku: String(v.sku).trim(), size: v.size as string | null, color: v.color as string | null }));
  const disp = new Map<string, number>();
  if (variants.length) {
    const { data: st } = await admin.from("stock").select("variant_id, quantity, reserved").eq("warehouse_id", ctx.wh).in("variant_id", variants.map((v) => v.id));
    for (const s of st ?? []) disp.set(s.variant_id as string, Math.max(0, Number(s.quantity) - Number(s.reserved ?? 0)));
  }
  const { data: pl } = await admin.from("price_list_items").select("price, promo_price").eq("price_list_id", ctx.pubListId).eq("product_id", productId).is("variant_id", null).maybeSingle();
  const { data: imgs } = await admin.from("product_images").select("id, path").eq("product_id", productId).order("is_primary", { ascending: false }).order("position").order("created_at");
  return {
    id: p.id as string, name: p.name as string, variationType: (p.variation_type as string) ?? "none",
    variants, disp,
    pub: pl ? { price: Number(pl.price), promo: pl.promo_price != null ? Number(pl.promo_price) : null } : null,
    images: (imgs ?? []).map((i) => ({ id: i.id as string, path: i.path as string })),
  };
}

/** Precio para TN de un producto SALE: lista Público (tachado) + promo Público si es menor. */
function salePrice(sp: SpProd): { price: string; promo: string | null } | null {
  if (!sp.pub) return null;
  const promo = sp.pub.promo != null && sp.pub.promo < sp.pub.price ? sp.pub.promo.toFixed(2) : null;
  return { price: sp.pub.price.toFixed(2), promo };
}

/** URL pública redimensionada (las originales de Woo superan los 8000px). */
function imageUrl(path: string): string {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/render/image/public/product-images/${enc}?width=1600&resize=contain`;
}

// ── Variantes: posición de talle/color en los atributos del producto de TN ──────

function attrIndex(attrs: string[]): { size: number; color: number } {
  return {
    size: attrs.findIndex((a) => /talle|size|tama|medida/i.test(a)),
    color: attrs.findIndex((a) => /color/i.test(a)),
  };
}
/** Valores de una variante de Spera en el orden de los atributos de TN (null = no se puede armar). */
function valuesFor(v: SpVar, attrs: string[]): string[] | null {
  const ix = attrIndex(attrs);
  const out: string[] = [];
  for (let i = 0; i < attrs.length; i++) {
    if (i === ix.size) out.push(v.size?.trim() || "Único");
    else if (i === ix.color) out.push(v.color?.trim() || "Único");
    else return null; // atributo que Spera no maneja (p. ej. "Modelo")
  }
  return out;
}
const comboKey = (vals: string[]) => vals.map(normVal).join("|");

/** ¿Ese SKU pertenece a OTRA variante de Spera (de cualquier producto)? */
async function skuIsOtherSperaVariant(ctx: SyncCtx, sku: string, mine: string): Promise<boolean> {
  const cands = [...new Set([sku, sku.toLowerCase(), sku.toUpperCase()])];
  const { data } = await ctx.admin.from("product_variants").select("id").eq("organization_id", ctx.orgId).in("sku", cands).limit(5);
  return (data ?? []).some((r) => r.id !== mine);
}

async function writeLinks(ctx: SyncCtx, rows: { variant_id: string; tn_product_id: string; tn_variant_id: string }[]) {
  if (!rows.length) return;
  const now = new Date().toISOString();
  await ctx.admin.from("tiendanube_links").upsert(
    rows.map((r) => ({ organization_id: ctx.orgId, ...r, last_synced_at: now })),
    { onConflict: "organization_id,variant_id" },
  );
  // Encolar para que el cron empuje el stock disponible actual a las recién vinculadas.
  await ctx.admin.from("tn_stock_sync_queue").upsert(
    rows.map((r) => ({ organization_id: ctx.orgId, variant_id: r.variant_id, enqueued_at: now })),
    { onConflict: "organization_id,variant_id" },
  );
}

// ── Fotos: agregar las que faltan ───────────────────────────────────────────────

async function syncImages(ctx: SyncCtx, sp: SpProd, tn: TNProd, r: ItemResult) {
  if (!ctx.imgTable) { r.notas.push("Fotos: falta correr la migración 0121"); return; }
  if (!sp.images.length) return;
  const { data: rec } = await ctx.admin.from("tn_image_links").select("product_image_id")
    .eq("organization_id", ctx.orgId).eq("tn_product_id", tn.id);
  const done = new Set((rec ?? []).map((x) => x.product_image_id as string));

  // Primera vez con un producto que YA tenía fotos en TN: las de hoy de Spera quedan
  // como base (no se suben repetidas). Desde acá, cada foto nueva de Spera se agrega.
  if (done.size === 0 && tn.images.length > 0) {
    const { error } = await ctx.admin.from("tn_image_links").insert(sp.images.map((im) => ({
      organization_id: ctx.orgId, product_image_id: im.id, tn_product_id: tn.id, tn_image_id: null,
    })));
    if (error) { r.notas.push(`Fotos: no se pudo registrar la base (${error.message})`); return; }
    r.notas.push(`Fotos: ya tenía ${tn.images.length} en TN; se tomaron como base`);
    return;
  }
  let pos = tn.images.length;
  for (const im of sp.images) {
    if (done.has(im.id)) continue;
    pos++;
    const res = await tnFetch(ctx.creds, `/products/${tn.id}/images`, { method: "POST", body: JSON.stringify({ src: imageUrl(im.path), position: pos }) });
    if (res.ok) {
      const body = (await res.json()) as { id?: number | string };
      const { error } = await ctx.admin.from("tn_image_links").insert({ organization_id: ctx.orgId, product_image_id: im.id, tn_product_id: tn.id, tn_image_id: body.id != null ? String(body.id) : null });
      r.fotosSubidas = (r.fotosSubidas ?? 0) + 1;
      // Si no queda registrada, la próxima pasada la volvería a subir: frenar acá.
      if (error) { r.notas.push(`Fotos: subida pero sin registrar (${error.message}); se frena para no duplicar`); return; }
    } else {
      r.notas.push(`Foto no subida (TN ${res.status})`);
    }
    await sleep(PAUSE);
  }
}

// ── Producto que YA existe en TN: vincular, completar variantes, fotos y precio ──

export async function reconcileExisting(ctx: SyncCtx, productId: string, tnProductId: string, opts: { sale: boolean; crearSinStock?: boolean }): Promise<ItemResult> {
  const sp = await loadSpera(ctx, productId);
  if (!sp) return { productId, name: "?", action: "error", notas: ["Producto inexistente en Spera"] };
  const r: ItemResult = { productId, name: sp.name, action: "actualizado", tnProductId, vinculadas: 0, variantesCreadas: 0, fotosSubidas: 0, precios: 0, notas: [] };
  const tn = await getTNProduct(ctx, tnProductId);
  if (!tn) return { ...r, action: "error", notas: ["El producto ya no existe en Tiendanube"] };
  if (!sp.variants.length) return { ...r, action: "omitido", notas: ["Sin variantes activas con SKU en Spera"] };

  const { data: lk } = await ctx.admin.from("tiendanube_links").select("variant_id, tn_product_id, tn_variant_id")
    .eq("organization_id", ctx.orgId).in("variant_id", sp.variants.map((v) => v.id));
  const linkBy = new Map((lk ?? []).map((l) => [l.variant_id as string, l]));

  const claimed = new Map<string, string>(); // tnVariantId → speraVariantId
  const pair = new Map<string, TNVar>();      // speraVariantId → TN variant
  const newLinks: { variant_id: string; tn_product_id: string; tn_variant_id: string }[] = [];
  const tnById = new Map(tn.variants.map((v) => [v.id, v]));

  // A) Vínculo existente dentro de este producto.
  for (const v of sp.variants) {
    const l = linkBy.get(v.id);
    if (l && l.tn_product_id === tn.id && tnById.has(l.tn_variant_id as string)) {
      claimed.set(l.tn_variant_id as string, v.id); pair.set(v.id, tnById.get(l.tn_variant_id as string)!);
    }
  }
  // Variantes de Spera vinculadas a OTRO producto de TN: no se tocan (no movemos vínculos).
  const elsewhere = new Set(sp.variants.filter((v) => { const l = linkBy.get(v.id); return l && !pair.has(v.id) && l.tn_product_id !== tn.id; }).map((v) => v.id));
  if (elsewhere.size) r.notas.push(`${elsewhere.size} variante(s) ya vinculadas a otro producto de TN (copia duplicada): no se tocan`);

  // B) Por SKU.
  for (const v of sp.variants) {
    if (pair.has(v.id) || elsewhere.has(v.id)) continue;
    const t = tn.variants.find((x) => !claimed.has(x.id) && x.sku && skuKey(x.sku) === skuKey(v.sku));
    if (t) { claimed.set(t.id, v.id); pair.set(v.id, t); newLinks.push({ variant_id: v.id, tn_product_id: tn.id, tn_variant_id: t.id }); }
  }
  // C) Por talle/color (solo match inequívoco, y sin robar el SKU de otra variante de Spera).
  const skuWrites: { v: SpVar; t: TNVar }[] = [];
  if (tn.attributes.length === 0) {
    // Producto sin variantes en TN (una sola fila) ↔ producto con una sola variante en Spera.
    const free = sp.variants.filter((v) => !pair.has(v.id) && !elsewhere.has(v.id));
    if (free.length === 1 && sp.variants.length === 1 && tn.variants.length === 1 && !claimed.has(tn.variants[0].id)) {
      const t = tn.variants[0];
      if (!t.sku || !(await skuIsOtherSperaVariant(ctx, t.sku, free[0].id))) {
        claimed.set(t.id, free[0].id); pair.set(free[0].id, t); newLinks.push({ variant_id: free[0].id, tn_product_id: tn.id, tn_variant_id: t.id }); skuWrites.push({ v: free[0], t });
      }
    }
  } else {
    for (const v of sp.variants) {
      if (pair.has(v.id) || elsewhere.has(v.id)) continue;
      const vals = valuesFor(v, tn.attributes);
      if (!vals) continue;
      const key = comboKey(vals);
      const cands = tn.variants.filter((x) => !claimed.has(x.id) && comboKey(x.values) === key);
      if (cands.length !== 1) continue; // 0 = falta (se crea abajo); >1 = ambiguo
      const t = cands[0];
      if (t.sku && skuKey(t.sku) !== skuKey(v.sku) && (await skuIsOtherSperaVariant(ctx, t.sku, v.id))) {
        r.notas.push(`Talle/color ${vals.join(" / ")}: el SKU de TN pertenece a otra variante de Spera, no se vincula`);
        continue;
      }
      claimed.set(t.id, v.id); pair.set(v.id, t); newLinks.push({ variant_id: v.id, tn_product_id: tn.id, tn_variant_id: t.id }); skuWrites.push({ v, t });
    }
  }
  await writeLinks(ctx, newLinks);
  r.vinculadas = newLinks.length;

  // Escribir el SKU de Spera en TN + (SALE) precio de lista y promo, en un solo PUT por variante.
  const sp$ = opts.sale ? salePrice(sp) : null;
  if (opts.sale && !sp$) r.notas.push("Sin precio Público en Spera: no se tocó el precio");
  const needSku = new Set(skuWrites.map((x) => x.v.id));
  for (const [vId, t] of pair) {
    const v = sp.variants.find((x) => x.id === vId)!;
    const body: Record<string, unknown> = {};
    if (needSku.has(vId) || (t.sku ?? "") !== v.sku) body.sku = v.sku;
    if (sp$) {
      if (Number(t.price) !== Number(sp$.price)) body.price = sp$.price;
      if ((t.promo == null ? null : Number(t.promo)) !== (sp$.promo == null ? null : Number(sp$.promo))) body.promotional_price = sp$.promo;
    }
    if (!Object.keys(body).length) continue;
    const res = await tnFetch(ctx.creds, `/products/${tn.id}/variants/${t.id}`, { method: "PUT", body: JSON.stringify(body) });
    if (!res.ok) r.notas.push(`No se pudo actualizar la variante ${v.sku} (TN ${res.status})`);
    else if (body.price !== undefined || body.promotional_price !== undefined) r.precios = (r.precios ?? 0) + 1;
    await sleep(PAUSE);
  }

  // Talles/colores que están en Spera y faltan en TN → crearlos.
  // Por defecto solo se crean los que tienen stock disponible (los en 0 llenarían la tienda
  // de opciones agotadas, casi siempre colores viejos). Se crean cuando entre stock y se
  // vuelva a conciliar, o tildando "crear también sin stock".
  const allMissing = sp.variants.filter((v) => !pair.has(v.id) && !elsewhere.has(v.id));
  const missing = opts.crearSinStock ? allMissing : allMissing.filter((v) => (sp.disp.get(v.id) ?? 0) > 0);
  if (allMissing.length > missing.length) r.notas.push(`${allMissing.length - missing.length} talle(s)/color(es) sin stock no se crearon`);
  if (missing.length) {
    if (tn.attributes.length === 0) {
      r.notas.push(`${missing.length} variante(s) sin crear: el producto en TN no tiene atributos de talle/color`);
    } else {
      const ix = attrIndex(tn.attributes);
      const used = new Set(tn.variants.map((x) => comboKey(x.values)));
      // Reusar la escritura que ya usa TN para cada valor ("Azul" y no "AZUL"): si no, el
      // selector de la tienda muestra dos opciones para el mismo color/talle.
      const spelling = tn.attributes.map((_, i) => {
        const m = new Map<string, string>();
        for (const x of tn.variants) if (x.values[i] != null && !m.has(normVal(x.values[i]))) m.set(normVal(x.values[i]), x.values[i]);
        return m;
      });
      const ref = tn.variants[0];
      const created: { variant_id: string; tn_product_id: string; tn_variant_id: string }[] = [];
      for (const v of missing) {
        const raw = valuesFor(v, tn.attributes);
        if (!raw) { r.notas.push(`Variante ${v.sku}: TN usa un atributo que Spera no maneja (${tn.attributes.join(", ")})`); continue; }
        const vals = raw.map((x, i) => spelling[i].get(normVal(x)) ?? x);
        if ((ix.size < 0 && v.size) || (ix.color < 0 && v.color)) { r.notas.push(`Variante ${v.sku}: en TN el producto no tiene ${ix.size < 0 ? "Talle" : "Color"}`); continue; }
        const key = comboKey(vals);
        if (used.has(key)) { r.notas.push(`Variante ${v.sku} (${vals.join(" / ")}): esa combinación ya existe en TN con otro SKU, revisar a mano`); continue; }
        const body: Record<string, unknown> = {
          values: vals.map((es) => ({ es })),
          price: sp$?.price ?? ref?.price ?? (sp.pub ? sp.pub.price.toFixed(2) : undefined),
          promotional_price: sp$ ? sp$.promo : (ref?.promo ?? null),
          stock: sp.disp.get(v.id) ?? 0, stock_management: true, sku: v.sku,
        };
        if (body.price == null) { r.notas.push(`Variante ${v.sku}: sin precio para crearla`); continue; }
        const res = await tnFetch(ctx.creds, `/products/${tn.id}/variants`, { method: "POST", body: JSON.stringify(body) });
        if (res.ok) {
          const nv = (await res.json()) as { id: number | string };
          created.push({ variant_id: v.id, tn_product_id: tn.id, tn_variant_id: String(nv.id) });
          used.add(key);
        } else {
          r.notas.push(`Variante ${v.sku}: TN ${res.status} ${(await res.text()).slice(0, 120)}`);
        }
        await sleep(PAUSE);
      }
      await writeLinks(ctx, created);
      r.variantesCreadas = created.length;
    }
  }

  await syncImages(ctx, sp, tn, r);
  return r;
}

// ── Producto que NO existe en TN: crearlo (oculto) ───────────────────────────────

export async function createInTN(ctx: SyncCtx, productId: string, opts: { published: boolean; sale: boolean }): Promise<ItemResult> {
  const sp = await loadSpera(ctx, productId);
  if (!sp) return { productId, name: "?", action: "error", notas: ["Producto inexistente en Spera"] };
  const r: ItemResult = { productId, name: sp.name, action: "creado", vinculadas: 0, variantesCreadas: 0, fotosSubidas: 0, precios: 0, notas: [] };
  if (!sp.variants.length) return { ...r, action: "omitido", notas: ["Sin variantes activas con SKU"] };

  // Red de seguridad anti-duplicado: si algún SKU ya está en TN, se concilia ese producto.
  for (const v of sp.variants.slice(0, 3)) {
    const existing = await findTNProductBySku(ctx, v.sku);
    if (existing) return reconcileExisting(ctx, productId, existing, { sale: opts.sale });
  }

  const price = opts.sale ? salePrice(sp) : (sp.pub ? { price: sp.pub.price.toFixed(2), promo: null } : null);
  if (!price) return { ...r, action: "omitido", notas: ["Sin precio Público en Spera"] };

  const vt = sp.variationType;
  const hasSize = vt === "size" || vt === "size_color";
  const hasColor = vt === "color" || vt === "size_color";
  const attributes: { es: string }[] = [];
  if (hasSize) attributes.push({ es: "Talle" });
  if (hasColor) attributes.push({ es: "Color" });

  const seen = new Set<string>();
  const variants: Record<string, unknown>[] = [];
  for (const v of sp.variants) {
    const values: { es: string }[] = [];
    if (hasSize) values.push({ es: v.size?.trim() || "Único" });
    if (hasColor) values.push({ es: v.color?.trim() || "Único" });
    const key = comboKey(values.map((x) => x.es));
    if (attributes.length && seen.has(key)) { r.notas.push(`Variante ${v.sku}: combinación repetida en Spera, no se crea`); continue; }
    seen.add(key);
    const out: Record<string, unknown> = { price: price.price, promotional_price: price.promo, stock: sp.disp.get(v.id) ?? 0, stock_management: true, sku: v.sku };
    if (values.length) out.values = values;
    variants.push(out);
    if (!attributes.length) break; // sin atributos TN admite una sola variante
  }

  const imgs = sp.images.slice(0, 20);
  const payload: Record<string, unknown> = { name: { es: sp.name }, published: opts.published, variants };
  if (attributes.length) payload.attributes = attributes;
  if (imgs.length) payload.images = imgs.map((im, i) => ({ src: imageUrl(im.path), position: i + 1 }));
  if (opts.sale && ctx.saleCategoryId) payload.categories = [Number(ctx.saleCategoryId)];

  const res = await tnFetch(ctx.creds, "/products", { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) return { ...r, action: "error", notas: [`Tiendanube ${res.status}: ${(await res.text()).slice(0, 180)}`] };
  const body = (await res.json()) as Record<string, unknown>;
  let tn = parseTNProduct(body);
  if (!tn.variants.length || tn.variants.some((v) => !v.sku)) tn = (await getTNProduct(ctx, tn.id)) ?? tn;
  r.tnProductId = tn.id;

  const bySku = new Map(tn.variants.filter((v) => v.sku).map((v) => [skuKey(v.sku), v.id]));
  const links = sp.variants.map((v) => { const t = bySku.get(skuKey(v.sku)); return t ? { variant_id: v.id, tn_product_id: tn.id, tn_variant_id: t } : null; })
    .filter(Boolean) as { variant_id: string; tn_product_id: string; tn_variant_id: string }[];
  await writeLinks(ctx, links);
  r.vinculadas = links.length;
  r.variantesCreadas = tn.variants.length;

  // Registrar las fotos subidas (mismo orden que el payload) para no repetirlas después.
  if (ctx.imgTable && imgs.length) {
    const tnImgs = ((body.images ?? []) as Record<string, unknown>[]).map((i) => String(i.id));
    await ctx.admin.from("tn_image_links").insert(imgs.map((im, i) => ({
      organization_id: ctx.orgId, product_image_id: im.id, tn_product_id: tn.id, tn_image_id: tnImgs[i] ?? null,
    })));
    r.fotosSubidas = tnImgs.length || imgs.length;
  }
  return r;
}

// ── Emparejar catálogo de TN con productos de Spera ─────────────────────────────

export async function pageAll<T>(fetchPage: (from: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await fetchPage(from);
    const b = data ?? [];
    out.push(...b);
    if (b.length < 1000) break;
  }
  return out;
}

/** Empareja productos de TN con productos de Spera: por SKU (mayoría de variantes) y, si no
 *  hay SKU en común, por NOMBRE exacto (normalizado) solo si es único en ambos lados. */
export async function matchCatalog(admin: Admin, org: string, catalog: TNProductLite[]) {
  const vars = await pageAll<{ product_id: string; sku: string }>((f) =>
    admin.from("product_variants").select("product_id, sku").eq("organization_id", org).eq("active", true).not("sku", "is", null).range(f, f + 999));
  const prodBySku = new Map(vars.map((v) => [String(v.sku).trim().toLowerCase(), v.product_id]));
  const prods = await pageAll<{ id: string; name: string }>((f) =>
    admin.from("products").select("id, name").eq("organization_id", org).eq("active", true).range(f, f + 999));
  const spByName = new Map<string, string[]>();
  for (const p of prods) { const k = norm(p.name); spByName.set(k, [...(spByName.get(k) ?? []), p.id]); }
  const nameById = new Map(prods.map((p) => [p.id, p.name]));
  const tnByName = new Map<string, number>();
  for (const t of catalog) tnByName.set(norm(t.name), (tnByName.get(norm(t.name)) ?? 0) + 1);

  const tnToSp = new Map<string, { sp: string; how: "sku" | "nombre" }>();
  const spTaken = new Set<string>();
  for (const t of catalog) {
    const votes = new Map<string, number>();
    for (const v of t.variants) { const p = v.sku ? prodBySku.get(v.sku.trim().toLowerCase()) : undefined; if (p) votes.set(p, (votes.get(p) ?? 0) + 1); }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) { tnToSp.set(t.id, { sp: best[0], how: "sku" }); spTaken.add(best[0]); }
  }
  for (const t of catalog) {
    if (tnToSp.has(t.id)) continue;
    const k = norm(t.name);
    const cands = (spByName.get(k) ?? []).filter((id) => !spTaken.has(id));
    if (cands.length === 1 && tnByName.get(k) === 1) { tnToSp.set(t.id, { sp: cands[0], how: "nombre" }); spTaken.add(cands[0]); }
  }
  return { tnToSp, nameById };
}

