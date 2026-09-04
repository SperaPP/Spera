"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";
import { publishTNProduct, setTNProductPublished } from "@/lib/tiendanube";

const variantSchema = z.object({
  size: z.string().trim().optional(),
  color: z.string().trim().optional(),
  sku: z.string().trim().optional(),
  stock: z.number().int().min(0).default(0),
});

const schema = z.object({
  name: z.string().trim().min(1, "Ingresá un nombre"),
  description: z.string().trim().optional(),
  categoryId: z.string().uuid().nullable(),
  mainCategoryId: z.string().uuid().nullable(),
  seasonId: z.string().uuid().nullable(),
  fabricTypeId: z.string().uuid().nullable(),
  variationType: z.enum(["none", "size", "color", "size_color"]),
  taxRate: z.number().min(0).max(100).default(21),
  warehouseId: z.string().uuid().nullable(),
  variants: z.array(variantSchema).min(1, "Agregá al menos una variante"),
  prices: z.array(
    z.object({ priceListId: z.string().uuid(), price: z.number().min(0).nullable() })
  ),
});

export type CrearProductoInput = z.infer<typeof schema>;

export async function crearProducto(
  input: CrearProductoInput
): Promise<ActionState & { id?: string }> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const d = parsed.data;

  const sb = await createClient();
  const { data, error } = await sb.rpc("create_product", {
    p_name: d.name,
    p_description: d.description ?? null,
    p_category_id: d.categoryId,
    p_fabric_type_id: d.fabricTypeId,
    p_variation_type: d.variationType,
    p_tax_rate: d.taxRate,
    p_variants: d.variants.map((v) => ({
      size: v.size ?? null,
      color: v.color ?? null,
      sku: v.sku ?? null,
      stock: v.stock,
    })),
    p_warehouse_id: d.warehouseId,
    p_prices: d.prices
      .filter((p) => p.price != null)
      .map((p) => ({ price_list_id: p.priceListId, price: p.price })),
  });

  if (error) return { error: error.message };

  const newId = data as string;

  // Categoría principal + temporada (no van en la RPC; se setean acá).
  if (d.mainCategoryId || d.seasonId) {
    await sb.from("products").update({ main_category_id: d.mainCategoryId, season_id: d.seasonId }).eq("id", newId);
  }

  // El precio cargado es Mayorista (base): derivar Publico (= Mayorista × 2).
  if (d.prices.some((p) => p.price != null)) {
    await sb.rpc("apply_product_pricing", { p_product_id: newId });
  }

  revalidatePath("/productos");
  return { ok: true, id: newId };
}

const editSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Ingresá un nombre"),
  description: z.string().trim().optional(),
  categoryId: z.string().uuid().nullable(),
  mainCategoryId: z.string().uuid().nullable(),
  seasonId: z.string().uuid().nullable(),
  fabricTypeId: z.string().uuid().nullable(),
  taxRate: z.number().min(0).max(100),
  active: z.boolean(),
  portalVisible: z.boolean(),
  lifecycle: z.enum(["actual", "discontinuo"]),
});

export type EditarProductoInput = z.infer<typeof editSchema>;

export async function editarProducto(input: EditarProductoInput): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const update: Record<string, unknown> = {
    name: d.name,
    description: d.description || null,
    category_id: d.categoryId,
    main_category_id: d.mainCategoryId,
    season_id: d.seasonId,
    fabric_type_id: d.fabricTypeId,
    tax_rate: d.taxRate,
    active: d.active,
    portal_visible: d.portalVisible,
    lifecycle: d.lifecycle,
  };
  // Si se discontinúa, se apaga la sincronización con Tiendanube automáticamente.
  if (d.lifecycle === "discontinuo") update.tn_sync = false;
  const { error } = await sb.from("products").update(update).eq("id", d.id);
  if (error) return { error: error.message };

  revalidatePath("/productos");
  revalidatePath(`/productos/${d.id}`);
  return { ok: true };
}

// ── Crear un valor de catálogo al vuelo desde el alta (gateado por Productos) ──
const CATALOG_TABLES = { categoria: "categories", tela: "fabric_types", talle: "sizes", color: "colors" } as const;
type CatalogKind = keyof typeof CATALOG_TABLES;

export async function agregarValorCatalogo(
  kind: CatalogKind,
  name: string
): Promise<ActionState & { item?: { id: string; name: string } }> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const table = CATALOG_TABLES[kind];
  if (!table) return { error: "Catálogo inválido" };
  const clean = name.trim();
  if (!clean) return { error: "Ingresá un nombre" };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  const row: Record<string, unknown> = { organization_id: orgId, name: clean };
  if (table === "sizes") row.position = 999;

  const { data, error } = await sb.from(table).insert(row).select("id, name").single();
  if (error) return { error: error.code === "23505" ? "Ya existe ese valor" : error.message };
  return { ok: true, item: data };
}

/** Marca/desmarca un producto como destacado (portal mayorista). */
export async function setDestacado(productId: string, value: boolean): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.from("products").update({ featured: value }).eq("id", productId);
  if (error) return { error: error.message };
  revalidatePath(`/productos/${productId}`);
  return { ok: true };
}

/** Publica/despublica un producto en el portal mayorista (sin afectar POS ni Tiendanube). */
export async function setPortalVisible(productId: string, value: boolean): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.from("products").update({ portal_visible: value }).eq("id", productId);
  if (error) return { error: error.message };
  revalidatePath(`/productos/${productId}`);
  return { ok: true };
}

// ── Sincronizar con Tiendanube (flag por producto; el push real es posterior) ──
export async function setTnSync(productId: string, value: boolean): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const sb = await createClient();
  // Un producto discontinuo no se manda a Tiendanube (la web es la vidriera vigente).
  if (value) {
    const { data: p } = await sb.from("products").select("lifecycle").eq("id", productId).maybeSingle();
    if (p?.lifecycle === "discontinuo") return { error: "Un producto discontinuo no se puede sincronizar con Tiendanube." };
  }
  const { error } = await sb.from("products").update({ tn_sync: value }).eq("id", productId);
  if (error) return { error: error.message };

  // Simétrico: prender el flag = subir/mostrar en la web; apagar = bajar (ocultar).
  const { data: org } = await sb.rpc("current_org_id");
  if (org) {
    const orgId = org as string;
    if (value) {
      const pub = await publishTNProduct(orgId, productId); // crea si es nuevo (no-op si ya existe)
      if (!pub.ok) {
        revalidatePath(`/productos/${productId}`);
        return { error: `Se marcó como sincronizado, pero no se pudo publicar en la web: ${pub.error}` };
      }
      const vis = await setTNProductPublished(orgId, productId, true); // asegurar visible (re-activación)
      if (!vis.ok) {
        revalidatePath(`/productos/${productId}`);
        return { error: `Publicado, pero no se pudo mostrar en la web: ${vis.error}` };
      }
    } else {
      const hid = await setTNProductPublished(orgId, productId, false); // bajar de la web
      if (!hid.ok) {
        revalidatePath(`/productos/${productId}`);
        return { error: `Se apagó el flag, pero no se pudo bajar de la web: ${hid.error}` };
      }
    }
  }
  revalidatePath(`/productos/${productId}`);
  return { ok: true };
}

// ── Precio Mayorista (base): guarda Mayorista; solo inicializa Publico si está vacío ──
export async function setPrecioMayorista(productId: string, mayorista: number): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  if (!isFinite(mayorista) || mayorista < 0) return { error: "Precio inválido" };
  const sb = await createClient();
  const { error } = await sb.rpc("apply_product_pricing", { p_product_id: productId, p_base: mayorista });
  if (error) return { error: error.message };
  revalidatePath(`/productos/${productId}`);
  revalidatePath("/precios");
  return { ok: true };
}

// ── Precio Publico (editable a mano, independiente de la fórmula) ──
export async function setPrecioPublico(productId: string, publico: number): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  if (!isFinite(publico) || publico < 0) return { error: "Precio inválido" };
  const sb = await createClient();
  const { error } = await sb.rpc("set_precio_publico", { p_product_id: productId, p_price: publico });
  if (error) return { error: error.message };
  revalidatePath(`/productos/${productId}`);
  revalidatePath("/precios");
  return { ok: true };
}

// ── Precio promocional por lista (null = apagar). Se cobra la promo si es menor. ──
export async function setPromoPrice(productId: string, listId: string, promo: number | null): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  if (promo != null && (!isFinite(promo) || promo < 0)) return { error: "Promo inválida" };
  const sb = await createClient();
  const { error } = await sb.rpc("set_promo_price", { p_list: listId, p_product: productId, p_promo: promo });
  if (error) return { error: error.message };
  revalidatePath(`/productos/${productId}`);
  revalidatePath("/precios");
  return { ok: true };
}

// ── Gestión de variantes ──────────────────────────────────────
const addVariantSchema = z.object({
  productId: z.string().uuid(),
  size: z.string().trim().optional(),
  color: z.string().trim().optional(),
  sku: z.string().trim().optional(),
  stock: z.number().int().min(0).default(0),
  warehouseId: z.string().uuid().nullable(),
});

export async function agregarVariante(input: z.infer<typeof addVariantSchema>): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const parsed = addVariantSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const { error } = await sb.rpc("add_variant", {
    p_product_id: d.productId, p_size: d.size ?? null, p_color: d.color ?? null,
    p_sku: d.sku ?? null, p_stock: d.stock, p_warehouse_id: d.stock > 0 ? d.warehouseId : null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/productos/${d.productId}`);
  return { ok: true };
}

export async function toggleVariante(variantId: string, active: boolean, productId: string): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.from("product_variants").update({ active }).eq("id", variantId);
  if (error) return { error: error.message };
  revalidatePath(`/productos/${productId}`);
  return { ok: true };
}

const ubicSchema = z.object({
  variantId: z.string().uuid(),
  productId: z.string().uuid(),
  fila: z.number().int().min(0).max(9999).nullable(),
  estante: z.number().int().min(0).max(9999).nullable(),
  cubiculo: z.number().int().min(0).max(9999).nullable(),
});

/** Ubicación en depósito de una variante (Fila - Estante - Cubículo). */
export async function setUbicacionVariante(input: z.infer<typeof ubicSchema>): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const parsed = ubicSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;
  const sb = await createClient();
  const { error } = await sb.from("product_variants")
    .update({ loc_fila: d.fila, loc_estante: d.estante, loc_cubiculo: d.cubiculo })
    .eq("id", d.variantId);
  if (error) return { error: error.message };
  revalidatePath(`/productos/${d.productId}`);
  return { ok: true };
}

export async function borrarVariante(variantId: string, productId: string): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.rpc("delete_variant", { p_variant_id: variantId });
  if (error) return { error: error.message };
  revalidatePath(`/productos/${productId}`);
  return { ok: true };
}

export type UbicResult = {
  variantId: string; sku: string | null; productName: string; variantLabel: string | null;
  fila: number | null; estante: number | null; cubiculo: number | null; active: boolean;
};

/** Busca variantes por SKU, código de barras o nombre de producto y devuelve su
 *  ubicación en depósito (fila / estante / cubículo). Solo lectura. */
export async function ubicarProducto(query: string): Promise<UbicResult[]> {
  const q = (query ?? "").trim();
  if (q.length < 2) return [];
  const sb = await createClient();
  const SEL = "id, sku, size, color, active, loc_fila, loc_estante, loc_cubiculo, products(name)";

  const byId = new Map<string, UbicResult>();
  const add = (v: Record<string, unknown>) => {
    if (byId.has(v.id as string)) return;
    const p = (Array.isArray(v.products) ? v.products[0] : v.products) as { name?: string } | null;
    const label = [v.size, v.color].filter(Boolean).join(" / ") || null;
    byId.set(v.id as string, {
      variantId: v.id as string, sku: (v.sku as string) ?? null, productName: p?.name ?? "—",
      variantLabel: label, fila: (v.loc_fila as number) ?? null, estante: (v.loc_estante as number) ?? null,
      cubiculo: (v.loc_cubiculo as number) ?? null, active: Boolean(v.active),
    });
  };

  // Por SKU / código de barras.
  if (/^[A-Za-z0-9._-]+$/.test(q)) {
    const { data } = await sb.from("product_variants").select(SEL).or(`sku.ilike.%${q}%,barcode.ilike.%${q}%`).limit(50);
    (data ?? []).forEach(add);
  }
  // Por nombre de producto.
  const { data: prods } = await sb.from("products").select("id").ilike("name", `%${q}%`).limit(30);
  const ids = (prods ?? []).map((p) => p.id);
  if (ids.length) {
    const { data } = await sb.from("product_variants").select(SEL).in("product_id", ids).limit(80);
    (data ?? []).forEach(add);
  }
  return [...byId.values()].slice(0, 100);
}
