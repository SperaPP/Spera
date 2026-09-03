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

export async function cerrarCaja(
  sessionId: string,
  declaredAmount: number,
  keptAmount: number,
  expenses: number,
  notes: string
): Promise<ActionState> {
  const denied = await requireCan("caja", true);
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("close_cash_session", {
    p_session_id: sessionId,
    p_declared_amount: declaredAmount,
    p_kept_amount: keptAmount,
    p_expenses: Math.max(0, expenses || 0),
    p_notes: notes || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/caja");
  return { ok: true };
}

// Cierre administrativo: cuando el cajero titular no está (faltó, se fue), un
// administrador cierra su caja para poder reemplazarlo. Requiere permiso caja_admin.
export async function cerrarCajaAdmin(
  sessionId: string,
  declaredAmount: number,
  keptAmount: number,
  expenses: number,
  notes: string
): Promise<ActionState> {
  const denied = await requireCan("caja_admin", true);
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("close_cash_session", {
    p_session_id: sessionId,
    p_declared_amount: declaredAmount,
    p_kept_amount: keptAmount,
    p_expenses: Math.max(0, expenses || 0),
    p_notes: notes ? `[Cierre administrativo] ${notes}` : "[Cierre administrativo]",
  });
  if (error) return { error: error.message };

  revalidatePath("/caja");
  revalidatePath(`/caja/${sessionId}`);
  return { ok: true };
}

/** Corrección de un cierre ya hecho (solo admin): recalcula esperado/diferencia
 *  y reajusta caja chica/fuerte para que cuadre. */
export async function corregirCierre(
  sessionId: string,
  declaredAmount: number,
  keptAmount: number,
  expenses: number,
  notes: string
): Promise<ActionState> {
  const denied = await requireCan("caja_admin", true);
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.rpc("correct_cash_session", {
    p_session_id: sessionId,
    p_declared: Math.max(0, declaredAmount || 0),
    p_kept: Math.max(0, keptAmount || 0),
    p_expenses: Math.max(0, expenses || 0),
    p_notes: notes || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/caja");
  revalidatePath(`/caja/${sessionId}`);
  revalidatePath("/caja/cierres");
  return { ok: true };
}

// ── Administración de caja ─────────────────────────────────────
export async function ajustarCaja(input: { storeId: string; target: "chica" | "fuerte"; delta: number; reason: string }): Promise<ActionState> {
  const denied = await requireCan("caja_admin", true);
  if (denied) return denied;
  if (!isFinite(input.delta) || input.delta === 0) return { error: "Ingresá un monto distinto de cero" };
  const sb = await createClient();
  const { error } = await sb.rpc("adjust_cash", {
    p_store_id: input.storeId, p_target: input.target,
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
