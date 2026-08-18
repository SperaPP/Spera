"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

export async function marcarControlado(saleId: string): Promise<ActionState> {
  const denied = await requireCan("logistica", true);
  if (denied) return denied;
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  const { error } = await sb
    .from("sales")
    .update({ fulfillment_status: "controlado", controlled_at: new Date().toISOString(), controlled_by: auth?.user?.id ?? null })
    .eq("id", saleId)
    .eq("fulfillment_status", "pendiente");
  if (error) return { error: error.message };
  revalidatePath("/logistica");
  revalidatePath(`/logistica/${saleId}`);
  return { ok: true };
}

export async function despacharPedido(saleId: string, shippingMethodId: string, tracking: string, notes: string): Promise<ActionState> {
  const denied = await requireCan("logistica", true);
  if (denied) return denied;
  if (!shippingMethodId) return { error: "Elegí el método de despacho" };
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  const { error } = await sb
    .from("sales")
    .update({
      fulfillment_status: "despachado",
      shipping_method_id: shippingMethodId,
      tracking: tracking.trim() || null,
      dispatch_notes: notes.trim() || null,
      dispatched_at: new Date().toISOString(),
      dispatched_by: auth?.user?.id ?? null,
    })
    .eq("id", saleId)
    .eq("fulfillment_status", "controlado");
  if (error) return { error: error.message };
  revalidatePath("/logistica");
  revalidatePath(`/logistica/${saleId}`);
  return { ok: true };
}
