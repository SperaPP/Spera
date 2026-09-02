import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

export const BUCKET_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images`;

// Datos casi estáticos (catálogo de categorías/temporadas, depósito central): se
// cachean unos minutos para no reconsultarlos en CADA navegación del portal.
const CACHE = { revalidate: 300 };

export const centralWarehouseId = unstable_cache(async (): Promise<string | null> => {
  const admin = createAdminClient();
  const { data } = await admin.from("warehouses").select("id").eq("name", "Mayorista - Central").maybeSingle();
  return data?.id ?? null;
}, ["portal-central-wh"], CACHE);

export const categoriasActivas = unstable_cache(async (): Promise<{ id: string; name: string }[]> => {
  const admin = createAdminClient();
  const { data } = await admin.from("categories").select("id, name").eq("active", true).order("name");
  return data ?? [];
}, ["portal-cats"], CACHE);

export const categoriasPrincipales = unstable_cache(async (org: string): Promise<{ id: string; name: string }[]> => {
  const admin = createAdminClient();
  const { data } = await admin.from("main_categories").select("id, name").eq("organization_id", org).order("name");
  return data ?? [];
}, ["portal-main-cats"], CACHE);

/** Categorías madre con una imagen representativa (primer producto con foto), para el home. */
export const mainCategoryTiles = unstable_cache(async (org: string): Promise<{ id: string; name: string; image: string | null }[]> => {
  const admin = createAdminClient();
  const { data: mains } = await admin.from("main_categories").select("id, name").eq("organization_id", org).order("position").order("name");
  const out: { id: string; name: string; image: string | null }[] = [];
  for (const m of mains ?? []) {
    const { data: p } = await admin.from("products").select("id").eq("organization_id", org).eq("main_category_id", m.id).eq("active", true).eq("has_image", true).limit(1).maybeSingle();
    let image: string | null = null;
    if (p) {
      const { data: im } = await admin.from("product_images").select("path").eq("product_id", p.id).order("is_primary", { ascending: false }).limit(1).maybeSingle();
      if (im) image = `${BUCKET_URL}/${im.path}`;
    }
    out.push({ id: m.id, name: m.name, image });
  }
  return out;
}, ["portal-main-tiles"], CACHE);

export const temporadasActivas = unstable_cache(async (org: string): Promise<{ id: string; name: string }[]> => {
  const admin = createAdminClient();
  const { data } = await admin.from("seasons").select("id, name").eq("organization_id", org).order("name");
  return data ?? [];
}, ["portal-seasons"], CACHE);

/** Opciones con productos disponibles + su conteo, para el contexto actual. */
export async function portalFacets(opts: {
  org: string; list: string; warehouse: string;
  main?: string | null; season?: string | null; search?: string | null;
}): Promise<{ mains: Map<string, number>; cats: Map<string, number>; seasons: Map<string, number> }> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("portal_facets", {
    p_org: opts.org, p_list: opts.list, p_warehouse: opts.warehouse,
    p_main: opts.main ?? null, p_season: opts.season ?? null, p_search: opts.search ?? null,
  });
  const mains = new Map<string, number>(), cats = new Map<string, number>(), seasons = new Map<string, number>();
  for (const r of (data ?? []) as { dim: string; id: string; cnt: number }[]) {
    const m = r.dim === "main" ? mains : r.dim === "cat" ? cats : r.dim === "season" ? seasons : null;
    if (m) m.set(r.id, Number(r.cnt));
  }
  return { mains, cats, seasons };
}

export type CatalogItem = { id: string; name: string; price: number; compareAt: number | null; publicPrice: number | null; stock: number; featured: boolean; image: string | null; sizes: string[] };

/** Precio efectivo: si hay promo activa (no nula y menor al de lista), ese es el
 *  precio; `compareAt` = precio de lista para mostrarlo tachado. */
function efectivo(base: number, promo: number | null): { price: number; compareAt: number | null } {
  if (promo != null && promo < base) return { price: promo, compareAt: base };
  return { price: base, compareAt: null };
}

/** Talles disponibles (variante activa con stock) por producto, para mostrar en la card. */
async function availableSizesByProduct(productIds: string[], warehouse: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!productIds.length) return out;
  const admin = createAdminClient();
  const { data: vs } = await admin.from("product_variants")
    .select("id, product_id, size").in("product_id", productIds).eq("active", true).not("size", "is", null);
  const rows = vs ?? [];
  const avail = new Set<string>();
  const ids = rows.map((v) => v.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data: st } = await admin.from("stock").select("variant_id, quantity, reserved").eq("warehouse_id", warehouse).in("variant_id", ids.slice(i, i + 200));
    for (const s of st ?? []) if (Math.max(0, Number(s.quantity) - Number(s.reserved ?? 0)) > 0) avail.add(s.variant_id);
  }
  for (const v of rows) {
    if (!avail.has(v.id) || !v.size) continue;
    const set = out.get(v.product_id) ?? [];
    if (!set.includes(v.size)) set.push(v.size);
    out.set(v.product_id, set);
  }
  return out;
}

/** Id de la lista "Publico" (precio de referencia minorista) de la organización. */
export const publicListId = unstable_cache(async (org: string): Promise<string | null> => {
  const admin = createAdminClient();
  const { data } = await admin.from("price_lists").select("id").eq("organization_id", org).eq("name", "Publico").maybeSingle();
  return data?.id ?? null;
}, ["portal-public-list"], CACHE);

/** Precio público por producto (variant_id null) para un set de productos. */
async function publicPriceByProduct(org: string, productIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!productIds.length) return out;
  const admin = createAdminClient();
  const pubId = await publicListId(org);
  if (!pubId) return out;
  const { data } = await admin.from("price_list_items")
    .select("product_id, price").eq("price_list_id", pubId).is("variant_id", null).in("product_id", productIds);
  for (const p of data ?? []) out.set(p.product_id, Number(p.price));
  return out;
}

/** Catálogo paginado (precio de la lista del cliente + stock de Central). */
export async function catalog(opts: {
  org: string; list: string; warehouse: string;
  category?: string | null; mainCategory?: string | null; season?: string | null;
  search?: string | null; featured?: boolean; sort?: string | null;
  limit: number; offset: number;
}): Promise<{ items: CatalogItem[]; total: number }> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("portal_catalog", {
    p_org: opts.org, p_list: opts.list, p_warehouse: opts.warehouse,
    p_category: opts.category ?? null, p_search: opts.search ?? null,
    p_featured: opts.featured ?? false, p_limit: opts.limit, p_offset: opts.offset,
    p_main_category: opts.mainCategory ?? null, p_season: opts.season ?? null,
    p_sort: opts.sort ?? "name",
  });
  const rows = (data ?? []) as { id: string; name: string; has_image: boolean; price: number; promo: number | null; stock: number; featured: boolean; total: number }[];
  const total = rows[0]?.total != null ? Number(rows[0].total) : 0;

  // Portada por producto (una query para toda la página).
  const withImg = rows.filter((r) => r.has_image).map((r) => r.id);
  const imgByProduct = new Map<string, string>();
  if (withImg.length) {
    const { data: imgs } = await admin.from("product_images")
      .select("product_id, path, is_primary").in("product_id", withImg).order("is_primary", { ascending: false });
    for (const im of imgs ?? []) if (!imgByProduct.has(im.product_id)) imgByProduct.set(im.product_id, im.path);
  }

  // Precio público (referencia) + talles disponibles para la card.
  const ids = rows.map((r) => r.id);
  const [pubByProduct, sizesByProduct] = await Promise.all([
    publicPriceByProduct(opts.org, ids),
    availableSizesByProduct(ids, opts.warehouse),
  ]);

  return {
    total,
    items: rows.map((r) => {
      const { price, compareAt } = efectivo(Number(r.price), r.promo != null ? Number(r.promo) : null);
      return {
        id: r.id, name: r.name, price, compareAt, publicPrice: pubByProduct.get(r.id) ?? null,
        stock: Number(r.stock), featured: r.featured,
        image: imgByProduct.has(r.id) ? `${BUCKET_URL}/${imgByProduct.get(r.id)}` : null,
        sizes: sizesByProduct.get(r.id) ?? [],
      };
    }),
  };
}

export type PortalProduct = {
  id: string; name: string; description: string | null; price: number; compareAt: number | null; publicPrice: number | null;
  variationType: string;
  images: string[];
  variants: { id: string; label: string | null; size: string | null; color: string | null; stock: number }[];
};

/** Detalle de un producto para el portal (precio + variantes con stock de Central). */
export async function portalProduct(productId: string, org: string, list: string, warehouse: string): Promise<PortalProduct | null> {
  const admin = createAdminClient();
  const { data: p } = await admin.from("products")
    .select("id, name, description, organization_id, active, variation_type, product_variants(id, size, color, active)")
    .eq("id", productId).maybeSingle();
  if (!p || p.organization_id !== org || !p.active) return null;

  const { data: pl } = await admin.from("price_list_items")
    .select("price, promo_price").eq("product_id", productId).is("variant_id", null).eq("price_list_id", list).maybeSingle();
  if (!pl) return null; // sin precio en la lista del cliente → no visible
  const { price: effPrice, compareAt } = efectivo(Number(pl.price), pl.promo_price != null ? Number(pl.promo_price) : null);

  // Solo variantes activas.
  const vars = ((p.product_variants ?? []) as { id: string; size: string | null; color: string | null; active: boolean }[]).filter((v) => v.active);
  const variantIds = vars.map((v) => v.id);
  const stockByVariant = new Map<string, number>();
  if (variantIds.length) {
    const { data: st } = await admin.from("stock").select("variant_id, quantity, reserved").eq("warehouse_id", warehouse).in("variant_id", variantIds);
    // Disponible = físico − reservado (no se ofrece lo comprometido por otros pedidos).
    for (const s of st ?? []) stockByVariant.set(s.variant_id, Math.max(0, Number(s.quantity) - Number(s.reserved ?? 0)));
  }

  const lbl = (s: string | null, c: string | null) => [s, c].filter(Boolean).join(" / ") || null;
  const variants = vars
    .map((v) => ({ id: v.id, label: lbl(v.size, v.color), size: v.size, color: v.color, stock: stockByVariant.get(v.id) ?? 0 }))
    .filter((v) => v.stock > 0);
  if (variants.length === 0) return null; // sin stock en ninguna variante activa → no disponible

  const pubById = await publicPriceByProduct(org, [productId]);
  const { data: imgs } = await admin.from("product_images").select("path, is_primary").eq("product_id", productId).order("is_primary", { ascending: false });

  return {
    id: p.id, name: p.name, description: p.description, price: effPrice, compareAt, publicPrice: pubById.get(productId) ?? null,
    variationType: (p.variation_type as string) ?? "none",
    images: (imgs ?? []).map((im) => `${BUCKET_URL}/${im.path}`),
    variants,
  };
}
