"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

export async function aceptarReposicion(
  storeId: string,
  items: { variantId: string; quantity: number }[]
): Promise<ActionState & { transferId?: string | null }> {
  const denied = await requireCan("reposiciones", true);
  if (denied) return denied;
  const sb = await createClient();
  const { data, error } = await sb.rpc("accept_replenishment", {
    p_store_id: storeId,
    p_items: items.filter((i) => i.quantity > 0).map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
  });
  if (error) return { error: error.message };
  revalidatePath("/reposiciones");
  revalidatePath(`/reposiciones/${storeId}`);
  return { ok: true, transferId: (data as string) ?? null };
}
