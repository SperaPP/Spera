"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, requireAdmin, type ActionState } from "@/lib/auth";

const schema = z.object({
  customerId: z.string().uuid(),
  storeId: z.string().uuid().nullable(),
  cashSessionId: z.string().uuid().nullable(),
  notes: z.string().trim().optional(),
  payments: z.array(z.object({
    paymentMethodId: z.string().uuid(),
    amount: z.number().positive(),
  })).min(1, "Agregá al menos un medio de pago"),
  allocations: z.array(z.object({
    saleId: z.string().uuid(),
    amount: z.number().positive(),
  })).optional(),
});

export type CrearCobranzaInput = z.infer<typeof schema>;

export type PedidoPendiente = { id: string; number: number; date: string; total: number; paid: number; remaining: number };

/** Pedidos del cliente con saldo pendiente (para imputar la cobranza), más viejos primero. */
export async function pedidosPendientes(customerId: string): Promise<PedidoPendiente[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("sales")
    .select("id, number, created_at, total, paid_amount")
    .eq("customer_id", customerId)
    .eq("status", "completada")
    .order("created_at", { ascending: true });
  return (data ?? [])
    .map((s) => ({
      id: s.id, number: s.number as number, date: s.created_at as string,
      total: Number(s.total), paid: Number(s.paid_amount),
      remaining: Math.round((Number(s.total) - Number(s.paid_amount)) * 100) / 100,
    }))
    .filter((s) => s.remaining > 0.01);
}

export async function crearCobranza(input: CrearCobranzaInput): Promise<ActionState & { number?: number }> {
  const denied = await requireCan("cobranzas", true);
  if (denied) return denied;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const { data: id, error } = await sb.rpc("create_receipt", {
    p_customer: d.customerId,
    p_store_id: d.storeId,
    p_cash_session_id: d.cashSessionId,
    p_payments: d.payments.map((p) => ({ payment_method_id: p.paymentMethodId, amount: p.amount })),
    p_allocations: (d.allocations ?? []).map((a) => ({ sale_id: a.saleId, amount: a.amount })),
    p_notes: d.notes ?? null,
  });
  if (error) return { error: error.message };

  const { data: rec } = await sb.from("receipts").select("number").eq("id", id as string).single();
  revalidatePath("/cobranzas");
  return { ok: true, number: rec?.number };
}

// Revertir una cobranza (solo admin): repone el saldo y deshace la imputación.
export async function anularCobranza(receiptId: string): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.rpc("cancel_receipt", { p_receipt_id: receiptId });
  if (error) return { error: error.message };
  revalidatePath("/cobranzas");
  revalidatePath(`/cobranzas/${receiptId}`);
  return { ok: true };
}
