"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

export async function abrirCaja(
  storeId: string,
  openingAmount: number
): Promise<ActionState> {
  const denied = await requireCan("caja", true);
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("open_cash_session", {
    p_store_id: storeId,
    p_opening_amount: openingAmount || 0,
  });
  if (error) return { error: error.message };

  revalidatePath("/caja");
  return { ok: true };
}

/** Administración marca un período cerrado como Entregado (viajó a central). */
export async function marcarEntregada(sessionId: string): Promise<ActionState> {
  const denied = await requireCan("caja", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.rpc("deliver_cash_session", { p_session_id: sessionId });
  if (error) return { error: error.message };
  revalidatePath("/caja");
  revalidatePath(`/caja/${sessionId}`);
  return { ok: true };
}

export async function cerrarCaja(
  sessionId: string,
  declaredAmount: number,
  notes: string
): Promise<ActionState> {
  const denied = await requireCan("caja", true);
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("close_cash_session", {
    p_session_id: sessionId,
    p_declared_amount: declaredAmount,
    p_notes: notes || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/caja");
  return { ok: true };
}
