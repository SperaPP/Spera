"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

const DAY = 24 * 60 * 60 * 1000;

/** Valida un ticket por N° para usarlo como alcance (minorista). */
export async function buscarTicket(numberStr: string):
  Promise<{ ok: true; saleId: string; number: number } | { ok: false; error: string }> {
  const n = parseInt(String(numberStr).trim(), 10);
  if (!n || n <= 0) return { ok: false, error: "Ingresá un N° de venta válido." };
  const sb = await createClient();
  const { data } = await sb.from("sales").select("id, number, status, created_at").eq("number", n).maybeSingle();
  if (!data) return { ok: false, error: `No se encontró la venta #${n}.` };
  if (data.status !== "completada") return { ok: false, error: `La venta #${n} está anulada.` };
  if (new Date(data.created_at).getTime() < Date.now() - 30 * DAY) return { ok: false, error: "La venta supera los 30 días de cambio." };
  return { ok: true, saleId: data.id, number: data.number };
}

export type PreviewItem = { variantId: string; requested: number; matched: number; credit: number };

/** Preview del crédito por devolución con matching FIFO (no escribe). */
export async function previewCambio(
  customerId: string | null,
  saleId: string | null,
  returned: { variantId: string; quantity: number }[]
): Promise<{ totalCredit: number; items: PreviewItem[]; allMatched: boolean }> {
  const list = returned.filter((r) => r.quantity > 0);
  if (list.length === 0) return { totalCredit: 0, items: [], allMatched: true };

  const sb = await createClient();
  const variantIds = [...new Set(list.map((r) => r.variantId))];
  let req = sb
    .from("sale_items")
    .select("variant_id, unit_price, quantity, returned_qty, sale_id, sales!inner(id, created_at, customer_id, status)")
    .in("variant_id", variantIds)
    .eq("sales.status", "completada")
    .gte("sales.created_at", new Date(Date.now() - 30 * DAY).toISOString());
  req = customerId ? req.eq("sales.customer_id", customerId) : req.eq("sale_id", saleId!);

  const { data } = await req;
  type Lot = { variant_id: string; unit_price: number; quantity: number; returned_qty: number; created_at: number };
  const lots: Lot[] = (data ?? []).map((si) => {
    const s = (Array.isArray(si.sales) ? si.sales[0] : si.sales) as { created_at: string } | null;
    return { variant_id: si.variant_id, unit_price: Number(si.unit_price), quantity: si.quantity, returned_qty: si.returned_qty, created_at: new Date(s?.created_at ?? 0).getTime() };
  }).filter((l) => l.quantity - l.returned_qty > 0);

  const items: PreviewItem[] = list.map((r) => {
    const varLots = lots.filter((l) => l.variant_id === r.variantId).sort((a, b) => a.created_at - b.created_at);
    let need = r.quantity, credit = 0, matched = 0;
    for (const l of varLots) {
      if (need <= 0) break;
      const take = Math.min(need, l.quantity - l.returned_qty);
      credit += take * l.unit_price; matched += take; need -= take;
    }
    return { variantId: r.variantId, requested: r.quantity, matched, credit };
  });
  return { totalCredit: items.reduce((a, i) => a + i.credit, 0), items, allMatched: items.every((i) => i.matched >= i.requested) };
}

const schema = z.object({
  storeId: z.string().uuid(),
  cashSessionId: z.string().uuid().nullable(),
  customerId: z.string().uuid().nullable(),
  scopeSaleId: z.string().uuid().nullable(),
  returned: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().positive() })).min(1, "Escaneá qué devolver"),
  priceListId: z.string().uuid().nullable(),
  newItems: z.array(z.object({
    variantId: z.string().uuid(), productName: z.string(), variantLabel: z.string().nullable(),
    quantity: z.number().int().positive(), unitPrice: z.number().min(0),
  })),
  diffPayments: z.array(z.object({ paymentMethodId: z.string().uuid(), amount: z.number().min(0) })),
});

export async function crearCambio(input: z.infer<typeof schema>): Promise<ActionState & { id?: string | null }> {
  const denied = await requireCan("pos", true);
  if (denied) return denied;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const { data, error } = await sb.rpc("create_exchange", {
    p_store_id: d.storeId,
    p_cash_session_id: d.cashSessionId,
    p_customer_id: d.customerId,
    p_scope_sale: d.scopeSaleId,
    p_returned: d.returned.map((r) => ({ variant_id: r.variantId, quantity: r.quantity })),
    p_price_list_id: d.priceListId,
    p_new_items: d.newItems.map((i) => ({ variant_id: i.variantId, product_name: i.productName, variant_label: i.variantLabel, quantity: i.quantity, unit_price: i.unitPrice })),
    p_diff_payments: d.diffPayments.map((p) => ({ payment_method_id: p.paymentMethodId, amount: p.amount })),
  });
  if (error) return { error: error.message };
  return { ok: true, id: (data as string | null) ?? null };
}
