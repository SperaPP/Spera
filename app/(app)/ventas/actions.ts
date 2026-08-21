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

/** Marca varios pedidos como impresos (para "Imprimir todos"). Solo los no impresos. */
export async function marcarArmadoImpresoBulk(ids: string[]): Promise<ActionState & { count?: number }> {
  const denied = await requireCan("ventas", false);
  if (denied) return denied;
  if (!ids.length) return { ok: true, count: 0 };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  const { data: auth } = await sb.auth.getUser();

  const { error, count } = await sb.from("sales")
    .update({ armado_printed_at: new Date().toISOString(), armado_printed_by: auth?.user?.id ?? null }, { count: "exact" })
    .in("id", ids).eq("organization_id", orgId).is("armado_printed_at", null);
  if (error) return { error: error.message };

  revalidatePath("/ventas");
  return { ok: true, count: count ?? 0 };
}

/** Reimprime una orden ya impresa. Reservado a administración; deja registro. */
export async function reimprimirArmado(saleId: string): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  const { data: auth } = await sb.auth.getUser();

  const { data: prev } = await sb.from("sales").select("armado_reprint_count").eq("id", saleId).maybeSingle();
  const { error } = await sb.from("sales").update({
    armado_reprint_count: (prev?.armado_reprint_count ?? 0) + 1,
    armado_last_reprint_at: new Date().toISOString(),
    armado_last_reprint_by: auth?.user?.id ?? null,
  }).eq("id", saleId).eq("organization_id", orgId);
  if (error) return { error: error.message };

  revalidatePath("/ventas");
  return { ok: true };
}
