"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

const schema = z.object({
  customerId: z.string().uuid(),
  storeId: z.string().uuid().nullable(),
  cashSessionId: z.string().uuid().nullable(),
  notes: z.string().trim().optional(),
  payments: z.array(z.object({
    paymentMethodId: z.string().uuid(),
    amount: z.number().positive(),
  })).min(1, "Agregá al menos un medio de pago"),
});

export type CrearCobranzaInput = z.infer<typeof schema>;

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
    p_notes: d.notes ?? null,
  });
  if (error) return { error: error.message };

  const { data: rec } = await sb.from("receipts").select("number").eq("id", id as string).single();
  revalidatePath("/cobranzas");
  return { ok: true, number: rec?.number };
}
