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
  return { ok: true };
}
