"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

const label = (size: string | null, color: string | null) =>
  [size, color].filter(Boolean).join(" / ") || null;

/** Busca productos por nombre y devuelve su precio en la lista indicada. */
export async function buscarProductos(query: string, priceListId: string | null) {
  const q = query.trim();
  if (q.length < 2) return [];

  const sb = await createClient();
  let req = sb
    .from("products")
    .select("id, name, variation_type, product_variants(id, size, color, sku, barcode), price_list_items(price, variant_id, price_list_id)")
    .eq("active", true)
    .ilike("name", `%${q}%`)
    .limit(15);
  if (priceListId) req = req.eq("price_list_items.price_list_id", priceListId);

  const { data } = await req;
  return (data ?? []).map((p) => {
    const items = (p.price_list_items ?? []) as { price: number; variant_id: string | null }[];
    const price = items.find((i) => i.variant_id === null)?.price ?? null;
    return {
      id: p.id,
      name: p.name,
      price,
      variants: ((p.product_variants ?? []) as { id: string; size: string | null; color: string | null; sku: string | null; barcode: string | null }[])
        .map((v) => ({ id: v.id, label: label(v.size, v.color), sku: v.sku })),
    };
  });
}

/** Busca una variante por código de barras o SKU (para el lector). */
export async function buscarPorCodigo(code: string, priceListId: string | null) {
  const c = code.trim();
  if (!c) return { notFound: true as const };

  const sb = await createClient();
  const sel = "id, size, color, sku, barcode, product_id, products(name)";
  let { data: v } = await sb.from("product_variants").select(sel).eq("barcode", c).limit(1).maybeSingle();
  if (!v) ({ data: v } = await sb.from("product_variants").select(sel).eq("sku", c).limit(1).maybeSingle());
  if (!v) return { notFound: true as const };

  let price: number | null = null;
  if (priceListId) {
    const { data: pli } = await sb
      .from("price_list_items")
      .select("price")
      .eq("price_list_id", priceListId)
      .eq("product_id", v.product_id)
      .is("variant_id", null)
      .maybeSingle();
    price = pli?.price ?? null;
  }
  const prod = v.products as unknown;
  const name = (Array.isArray(prod) ? prod[0]?.name : (prod as { name: string } | null)?.name) ?? "";

  return {
    notFound: false as const,
    variantId: v.id,
    productId: v.product_id as string,
    name,
    label: label(v.size, v.color),
    sku: v.sku,
    price,
  };
}

const schema = z.object({
  storeId: z.string().uuid(),
  cashSessionId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  priceListId: z.string().uuid().nullable(),
  discount: z.number().min(0).default(0),
  items: z.array(z.object({
    variantId: z.string().uuid(),
    productName: z.string(),
    variantLabel: z.string().nullable(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().min(0),
  })).min(1, "El carrito está vacío"),
  payments: z.array(z.object({
    paymentMethodId: z.string().uuid(),
    amount: z.number().min(0),
    surcharge: z.number().min(0).default(0),
  })),
});

export type CrearVentaInput = z.infer<typeof schema>;

export async function crearVenta(input: CrearVentaInput): Promise<ActionState & { number?: number }> {
  const denied = await requireCan("pos", true);
  if (denied) return denied;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const { data: id, error } = await sb.rpc("create_sale", {
    p_store_id: d.storeId,
    p_cash_session_id: d.cashSessionId,
    p_customer_id: d.customerId,
    p_price_list_id: d.priceListId,
    p_discount: d.discount,
    p_items: d.items.map((i) => ({
      variant_id: i.variantId,
      product_name: i.productName,
      variant_label: i.variantLabel,
      quantity: i.quantity,
      unit_price: i.unitPrice,
    })),
    p_payments: d.payments.map((p) => ({
      payment_method_id: p.paymentMethodId,
      amount: p.amount,
      surcharge: p.surcharge,
    })),
  });
  if (error) return { error: error.message };

  const { data: sale } = await sb.from("sales").select("number").eq("id", id as string).single();
  return { ok: true, number: sale?.number };
}
