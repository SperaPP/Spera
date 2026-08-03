"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, type ActionState } from "@/lib/auth";

/** Anula una venta (destructivo → reservado a administrador). */
export async function anularVenta(saleId: string): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("cancel_sale", { p_sale_id: saleId });
  if (error) return { error: error.message };

  revalidatePath("/ventas");
  revalidatePath(`/ventas/${saleId}`);
  return { ok: true };
}
