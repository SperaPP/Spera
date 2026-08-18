"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

const DAY = 24 * 60 * 60 * 1000;

export type CambioSaleItem = {
  id: string; productName: string; variantLabel: string | null;
  quantity: number; unitPrice: number; returnedQty: number; remaining: number;
};
export type CambioSale = {
  id: string; number: number; createdAt: string; storeName: string | null;
  within30: boolean; items: CambioSaleItem[];
};

/** Busca una venta por N° para armar un cambio. */
export async function buscarVentaParaCambio(numberStr: string):
  Promise<{ ok: true; sale: CambioSale } | { ok: false; error: string }> {
  const n = parseInt(String(numberStr).trim(), 10);
  if (!n || n <= 0) return { ok: false, error: "Ingresá un N° de venta válido." };

  const sb = await createClient();
  const { data } = await sb
    .from("sales")
    .select("id, number, created_at, status, stores(name), sale_items(id, product_name, variant_label, quantity, unit_price, returned_qty)")
    .eq("number", n)
    .maybeSingle();

  if (!data) return { ok: false, error: `No se encontró la venta #${n}.` };
  if (data.status !== "completada") return { ok: false, error: `La venta #${n} está anulada.` };

  const store = Array.isArray(data.stores) ? data.stores[0] : data.stores;
  const items = ((data.sale_items ?? []) as { id: string; product_name: string; variant_label: string | null; quantity: number; unit_price: number; returned_qty: number }[])
    .map((it) => ({
      id: it.id, productName: it.product_name, variantLabel: it.variant_label,
      quantity: it.quantity, unitPrice: Number(it.unit_price), returnedQty: it.returned_qty,
      remaining: it.quantity - it.returned_qty,
    }));

  const within30 = new Date(data.created_at).getTime() >= Date.now() - 30 * DAY;

  return {
    ok: true,
    sale: {
      id: data.id, number: data.number, createdAt: data.created_at,
      storeName: (store as { name: string } | null)?.name ?? null, within30, items,
    },
  };
}

const schema = z.object({
  storeId: z.string().uuid(),
  cashSessionId: z.string().uuid().nullable(),
  originalSaleId: z.string().uuid(),
  returned: z.array(z.object({ saleItemId: z.string().uuid(), quantity: z.number().int().positive() })).min(1, "Elegí qué devolver"),
  newItems: z.array(z.object({
    variantId: z.string().uuid(), productName: z.string(), variantLabel: z.string().nullable(),
    quantity: z.number().int().positive(), unitPrice: z.number().min(0),
  })).min(1, "Elegí la prenda nueva"),
  diffPayments: z.array(z.object({ paymentMethodId: z.string().uuid(), amount: z.number().min(0) })),
});

export async function crearCambio(input: z.infer<typeof schema>): Promise<ActionState & { id?: string }> {
  const denied = await requireCan("pos", true);
  if (denied) return denied;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const { data, error } = await sb.rpc("create_exchange", {
    p_store_id: d.storeId,
    p_cash_session_id: d.cashSessionId,
    p_original_sale: d.originalSaleId,
    p_returned: d.returned.map((r) => ({ sale_item_id: r.saleItemId, quantity: r.quantity })),
    p_new_items: d.newItems.map((i) => ({
      variant_id: i.variantId, product_name: i.productName, variant_label: i.variantLabel,
      quantity: i.quantity, unit_price: i.unitPrice,
    })),
    p_diff_payments: d.diffPayments.map((p) => ({ payment_method_id: p.paymentMethodId, amount: p.amount })),
  });
  if (error) return { error: error.message };
  return { ok: true, id: data as string };
}
