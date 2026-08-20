"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireCan, type ActionState } from "@/lib/auth";

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

/** Marca la orden de armado como impresa (una sola vez). Devuelve si ya estaba impresa. */
export async function marcarArmadoImpreso(saleId: string): Promise<ActionState & { alreadyPrinted?: boolean }> {
  const denied = await requireCan("ventas", false);
  if (denied) return denied;

  const sb = await createClient();
  // ¿Ya estaba impresa antes de este click?
  const { data: prev } = await sb.from("sales").select("armado_printed_at").eq("id", saleId).maybeSingle();
  const already = prev?.armado_printed_at != null;

  const { error } = await sb.rpc("mark_armado_printed", { p_sale_id: saleId });
  if (error) return { error: error.message };

  revalidatePath("/ventas");
  return { ok: true, alreadyPrinted: already };
}
