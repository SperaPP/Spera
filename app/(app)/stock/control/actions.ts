"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

export type CountVariant = { variantId: string; label: string | null; sku: string | null; system: number };
export type CountProduct = { id: string; name: string; variants: CountVariant[] };

const lbl = (s: string | null, c: string | null) => [s, c].filter(Boolean).join(" / ") || null;

/** Arma los productos (con sus variantes + stock del depósito) a partir de sus ids. */
async function shapeProducts(sb: Awaited<ReturnType<typeof createClient>>, productIds: string[], warehouseId: string): Promise<CountProduct[]> {
  if (productIds.length === 0) return [];
  const { data: prods } = await sb
    .from("products")
    .select("id, name, product_variants(id, size, color, sku)")
    .in("id", productIds)
    .order("name");
  const variantIds = (prods ?? []).flatMap((p) => (p.product_variants as { id: string }[] ?? []).map((v) => v.id));
  const stockByVariant = new Map<string, number>();
  if (variantIds.length) {
    const { data: st } = await sb.from("stock").select("variant_id, quantity").eq("warehouse_id", warehouseId).in("variant_id", variantIds);
    for (const s of st ?? []) stockByVariant.set(s.variant_id, Number(s.quantity));
  }
  return (prods ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    variants: (p.product_variants as { id: string; size: string | null; color: string | null; sku: string | null }[] ?? [])
      .map((v) => ({ variantId: v.id, label: lbl(v.size, v.color), sku: v.sku, system: stockByVariant.get(v.id) ?? 0 })),
  }));
}

/** Escanea un código → devuelve el producto (con variantes + stock) y la variante escaneada. */
export async function escanearConteo(code: string, warehouseId: string):
  Promise<{ ok: true; variantId: string; product: CountProduct } | { ok: false; error: string; notFound?: boolean }> {
  const c = code.trim();
  if (!c) return { ok: false, error: "Código vacío." };
  if (!warehouseId) return { ok: false, error: "Elegí la sucursal." };
  const sb = await createClient();
  const sel = "id, product_id";
  let { data: v } = await sb.from("product_variants").select(sel).eq("barcode", c).limit(1).maybeSingle();
  if (!v) ({ data: v } = await sb.from("product_variants").select(sel).eq("sku", c).limit(1).maybeSingle());
  if (!v) return { ok: false, notFound: true, error: `Código ${c}: sin resultados.` };
  const [product] = await shapeProducts(sb, [v.product_id], warehouseId);
  if (!product) return { ok: false, error: "Producto no encontrado." };
  return { ok: true, variantId: v.id, product };
}

/** Carga todos los productos de una categoría (con variantes + stock) al conteo. */
export async function cargarCategoriaConteo(categoryId: string, warehouseId: string):
  Promise<{ ok: true; products: CountProduct[] } | { ok: false; error: string }> {
  if (!categoryId) return { ok: false, error: "Elegí una categoría." };
  if (!warehouseId) return { ok: false, error: "Elegí la sucursal." };
  const sb = await createClient();
  const { data: prods } = await sb.from("products").select("id").eq("category_id", categoryId).eq("active", true).limit(500);
  const products = await shapeProducts(sb, (prods ?? []).map((p) => p.id), warehouseId);
  return { ok: true, products };
}

const schema = z.object({
  warehouseId: z.string().uuid(),
  counts: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(0) })).min(1, "El conteo está vacío"),
});

export async function aplicarConteo(input: z.infer<typeof schema>): Promise<ActionState & { count?: number }> {
  const denied = await requireCan("control_stock", true);
  if (denied) return denied;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;
  const sb = await createClient();
  const { data, error } = await sb.rpc("apply_stock_count", {
    p_warehouse_id: d.warehouseId,
    p_counts: d.counts.map((c) => ({ variant_id: c.variantId, quantity: c.quantity })),
  });
  if (error) return { error: error.message };
  revalidatePath("/stock");
  return { ok: true, count: (data as number) ?? 0 };
}
