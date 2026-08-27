import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const BUCKET_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images`;

export async function centralWarehouseId(): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("warehouses").select("id").eq("name", "Mayorista - Central").maybeSingle();
  return data?.id ?? null;
}

export async function categoriasActivas(): Promise<{ id: string; name: string }[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("categories").select("id, name").eq("active", true).order("name");
  return data ?? [];
}

export type CatalogItem = { id: string; name: string; price: number; publicPrice: number | null; stock: number; featured: boolean; image: string | null };

/** Id de la lista "Publico" (precio de referencia minorista) de la organización. */
export async function publicListId(org: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("price_lists").select("id").eq("organization_id", org).eq("name", "Publico").maybeSingle();
  return data?.id ?? null;
}

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
  category?: string | null; search?: string | null; featured?: boolean;
  limit: number; offset: number;
}): Promise<{ items: CatalogItem[]; total: number }> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("portal_catalog", {
    p_org: opts.org, p_list: opts.list, p_warehouse: opts.warehouse,
    p_category: opts.category ?? null, p_search: opts.search ?? null,
    p_featured: opts.featured ?? false, p_limit: opts.limit, p_offset: opts.offset,
  });
  const rows = (data ?? []) as { id: string; name: string; has_image: boolean; price: number; stock: number; featured: boolean; total: number }[];
  const total = rows[0]?.total != null ? Number(rows[0].total) : 0;

  // Portada por producto (una query para toda la página).
  const withImg = rows.filter((r) => r.has_image).map((r) => r.id);
  const imgByProduct = new Map<string, string>();
  if (withImg.length) {
    const { data: imgs } = await admin.from("product_images")
      .select("product_id, path, is_primary").in("product_id", withImg).order("is_primary", { ascending: false });
    for (const im of imgs ?? []) if (!imgByProduct.has(im.product_id)) imgByProduct.set(im.product_id, im.path);
  }

  // Precio público (referencia) para comparar contra el de la lista del cliente.
  const pubByProduct = await publicPriceByProduct(opts.org, rows.map((r) => r.id));

  return {
    total,
    items: rows.map((r) => ({
      id: r.id, name: r.name, price: Number(r.price), publicPrice: pubByProduct.get(r.id) ?? null,
      stock: Number(r.stock), featured: r.featured,
      image: imgByProduct.has(r.id) ? `${BUCKET_URL}/${imgByProduct.get(r.id)}` : null,
    })),
  };
}

export type PortalProduct = {
  id: string; name: string; description: string | null; price: number; publicPrice: number | null;
  images: string[];
  variants: { id: string; label: string | null; stock: number }[];
};

/** Detalle de un producto para el portal (precio + variantes con stock de Central). */
export async function portalProduct(productId: string, org: string, list: string, warehouse: string): Promise<PortalProduct | null> {
  const admin = createAdminClient();
  const { data: p } = await admin.from("products")
    .select("id, name, description, organization_id, active, product_variants(id, size, color)")
    .eq("id", productId).maybeSingle();
  if (!p || p.organization_id !== org || !p.active) return null;

  const { data: pl } = await admin.from("price_list_items")
    .select("price").eq("product_id", productId).is("variant_id", null).eq("price_list_id", list).maybeSingle();
  if (!pl) return null; // sin precio en la lista del cliente → no visible

  const pubById = await publicPriceByProduct(org, [productId]);

  const vars = (p.product_variants ?? []) as { id: string; size: string | null; color: string | null }[];
  const variantIds = vars.map((v) => v.id);
  const stockByVariant = new Map<string, number>();
  if (variantIds.length) {
    const { data: st } = await admin.from("stock").select("variant_id, quantity, reserved").eq("warehouse_id", warehouse).in("variant_id", variantIds);
    // Disponible = físico − reservado (no se ofrece lo comprometido por otros pedidos).
    for (const s of st ?? []) stockByVariant.set(s.variant_id, Math.max(0, Number(s.quantity) - Number(s.reserved ?? 0)));
  }

  const { data: imgs } = await admin.from("product_images").select("path, is_primary").eq("product_id", productId).order("is_primary", { ascending: false });

  const lbl = (s: string | null, c: string | null) => [s, c].filter(Boolean).join(" / ") || null;
  return {
    id: p.id, name: p.name, description: p.description, price: Number(pl.price), publicPrice: pubById.get(productId) ?? null,
    images: (imgs ?? []).map((im) => `${BUCKET_URL}/${im.path}`),
    variants: vars.map((v) => ({ id: v.id, label: lbl(v.size, v.color), stock: stockByVariant.get(v.id) ?? 0 }))
      .filter((v) => v.stock > 0),
  };
}
