"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

export async function marcarControlado(saleId: string, scanned: Record<string, number>): Promise<ActionState> {
  const denied = await requireCan("logistica", true);
  if (denied) return denied;
  const sb = await createClient();
  // El servidor valida que lo escaneado coincida con el pedido antes de pasar a controlado.
  const { error } = await sb.rpc("control_sale", { p_sale_id: saleId, p_scanned: scanned });
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
  // El despacho descuenta el físico y libera la reserva (RPC atómica).
  const { error } = await sb.rpc("dispatch_sale", {
    p_sale_id: saleId,
    p_shipping_method_id: shippingMethodId,
    p_tracking: tracking.trim() || null,
    p_notes: notes.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/logistica");
  revalidatePath(`/logistica/${saleId}`);
  return { ok: true };
}
