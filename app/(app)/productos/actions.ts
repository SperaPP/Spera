"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

const variantSchema = z.object({
  size: z.string().trim().optional(),
  color: z.string().trim().optional(),
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
