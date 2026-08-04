"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

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

  revalidatePath("/productos");
  return { ok: true, id: data as string };
}

const editSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Ingresá un nombre"),
  description: z.string().trim().optional(),
  categoryId: z.string().uuid().nullable(),
  fabricTypeId: z.string().uuid().nullable(),
  taxRate: z.number().min(0).max(100),
  active: z.boolean(),
});

export type EditarProductoInput = z.infer<typeof editSchema>;

export async function editarProducto(input: EditarProductoInput): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const { error } = await sb.from("products").update({
    name: d.name,
    description: d.description || null,
    category_id: d.categoryId,
    fabric_type_id: d.fabricTypeId,
    tax_rate: d.taxRate,
    active: d.active,
  }).eq("id", d.id);
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

export async function borrarVariante(variantId: string, productId: string): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.rpc("delete_variant", { p_variant_id: variantId });
  if (error) return { error: error.message };
  revalidatePath(`/productos/${productId}`);
  return { ok: true };
}
