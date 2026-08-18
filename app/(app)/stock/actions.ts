"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

export async function ajustarStock(
  warehouseId: string,
  variantId: string,
  newQty: number,
  productId: string
): Promise<ActionState> {
  const denied = await requireCan("stock", true);
  if (denied) return denied;
  if (!Number.isInteger(newQty) || newQty < 0) return { error: "Cantidad inválida" };

  const sb = await createClient();
  const { error } = await sb.rpc("adjust_stock", {
    p_warehouse_id: warehouseId,
    p_variant_id: variantId,
    p_new_quantity: newQty,
    p_reason: "ajuste",
  });
  if (error) return { error: error.message };

  revalidatePath(`/stock/${productId}`);
  revalidatePath("/stock");
  return { ok: true };
}

/** Variantes + stock por depósito de un producto (para ajustar inline en la lista). */
export async function cargarMatrizStock(productId: string): Promise<{
  variants: { id: string; label: string; sku: string | null }[];
  stockMap: Record<string, number>;
}> {
  const sb = await createClient();
  const { data: product } = await sb
    .from("products")
    .select("id, product_variants(id, size, color, sku)")
    .eq("id", productId)
    .single();
  const variants = ((product?.product_variants ?? []) as { id: string; size: string | null; color: string | null; sku: string | null }[])
    .map((v) => ({ id: v.id, label: [v.size, v.color].filter(Boolean).join(" / ") || "Única", sku: v.sku }));

  const stockMap: Record<string, number> = {};
  const variantIds = variants.map((v) => v.id);
  if (variantIds.length) {
    const { data: st } = await sb.from("stock").select("variant_id, warehouse_id, quantity").in("variant_id", variantIds);
    for (const s of st ?? []) stockMap[`${s.variant_id}|${s.warehouse_id}`] = Number(s.quantity);
  }
  return { variants, stockMap };
}
