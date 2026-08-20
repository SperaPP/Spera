"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

export async function abrirCaja(storeId: string): Promise<ActionState> {
  const denied = await requireCan("caja", true);
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("open_cash_session", { p_store_id: storeId });
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
  keptAmount: number,
  notes: string
): Promise<ActionState> {
  const denied = await requireCan("caja", true);
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("close_cash_session", {
    p_session_id: sessionId,
    p_declared_amount: declaredAmount,
    p_kept_amount: keptAmount,
    p_notes: notes || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/caja");
  return { ok: true };
}

// ── Administración de caja ─────────────────────────────────────
export async function ajustarCaja(input: { storeId: string; target: "chica" | "fuerte"; cashierId: string | null; delta: number; reason: string }): Promise<ActionState> {
  const denied = await requireCan("caja_admin", true);
  if (denied) return denied;
  if (!isFinite(input.delta) || input.delta === 0) return { error: "Ingresá un monto distinto de cero" };
  if (input.target === "chica" && !input.cashierId) return { error: "Elegí el cajero" };
  const sb = await createClient();
  const { error } = await sb.rpc("adjust_cash", {
    p_store_id: input.storeId, p_target: input.target,
    p_cashier: input.target === "chica" ? input.cashierId : null,
    p_delta: input.delta, p_reason: input.reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/caja");
  return { ok: true };
}

export async function entregarACentral(storeId: string, amount: number, notes: string): Promise<ActionState> {
  const denied = await requireCan("caja_admin", true);
  if (denied) return denied;
  if (!(amount > 0)) return { error: "Ingresá un monto mayor a cero" };
  const sb = await createClient();
  const { error } = await sb.rpc("deliver_to_central", { p_store_id: storeId, p_amount: amount, p_notes: notes || null });
  if (error) return { error: error.message };
  revalidatePath("/caja");
  return { ok: true };
}
