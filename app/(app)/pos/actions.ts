"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

const label = (size: string | null, color: string | null) =>
  [size, color].filter(Boolean).join(" / ") || null;

// Miniatura vía el redimensionado de Supabase: mucho más liviana para el POS.
const renderUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/render/image/public/product-images`;
function imageUrl(images: { path: string; is_primary: boolean }[] | null | undefined): string | null {
  const list = images ?? [];
  if (list.length === 0) return null;
  const chosen = list.find((i) => i.is_primary) ?? list[0];
  return `${renderUrl}/${chosen.path}?width=300&quality=70`;
}

/** Busca productos por nombre y devuelve su precio en la lista indicada. */
export async function buscarProductos(query: string, priceListId: string | null) {
  const q = query.trim();
  if (q.length < 2) return [];

  const sb = await createClient();
  let req = sb
    .from("products")
    .select("id, name, variation_type, product_images(path, is_primary), product_variants(id, size, color, sku, barcode), price_list_items(price, variant_id, price_list_id)")
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
      image: imageUrl(p.product_images as { path: string; is_primary: boolean }[] | null),
      variants: ((p.product_variants ?? []) as { id: string; size: string | null; color: string | null; sku: string | null; barcode: string | null }[])
        .map((v) => ({ id: v.id, label: label(v.size, v.color), sku: v.sku })),
    };
  });
}

/** Lista productos para la grilla del POS: por defecto (sin query) prioriza los que
 *  tienen foto; con query filtra por nombre. Devuelve precio en la lista indicada. */
export async function listarProductosPOS(query: string, priceListId: string | null) {
  const q = query.trim();
  const sb = await createClient();
  let req = sb
    .from("products")
    .select("id, name, product_images(path, is_primary), product_variants(id, size, color, sku, barcode), price_list_items(price, variant_id, price_list_id)")
    .eq("active", true);
  if (priceListId) req = req.eq("price_list_items.price_list_id", priceListId);
  req = q.length >= 2
    ? req.ilike("name", `%${q}%`).order("name").limit(40)
    : req.order("has_image", { ascending: false }).order("name").limit(40);

  const { data } = await req;
  return (data ?? []).map((p) => {
    const items = (p.price_list_items ?? []) as { price: number; variant_id: string | null }[];
    const price = priceListId ? (items.find((i) => i.variant_id === null)?.price ?? null) : null;
    return {
      id: p.id,
      name: p.name,
      price,
      image: imageUrl(p.product_images as { path: string; is_primary: boolean }[] | null),
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
  const sel = "id, size, color, sku, barcode, product_id, products(name, product_images(path, is_primary))";
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
  const prod = (Array.isArray(v.products) ? v.products[0] : v.products) as { name: string; product_images: { path: string; is_primary: boolean }[] } | null;
  const name = prod?.name ?? "";

  return {
    notFound: false as const,
    variantId: v.id,
    productId: v.product_id as string,
    name,
    label: label(v.size, v.color),
    sku: v.sku,
    price,
    image: imageUrl(prod?.product_images),
  };
}

/** Valida un cupón contra el subtotal actual (preview del POS, no incrementa uso). */
export async function validarCupon(code: string, subtotal: number): Promise<
  { ok: true; couponId: string; discount: number; discountType: "percent" | "amount"; discountValue: number; minAmount: number | null }
  | { ok: false; error: string }
> {
  const clean = code.trim();
  if (!clean) return { ok: false, error: "Ingresá un código." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("validate_coupon", { p_code: clean, p_subtotal: subtotal });
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: "Cupón inválido." };
  return {
    ok: true,
    couponId: row.coupon_id as string,
    discount: Number(row.discount),
    discountType: row.discount_type as "percent" | "amount",
    discountValue: Number(row.discount_value),
    minAmount: row.min_amount != null ? Number(row.min_amount) : null,
  };
}

type ShapedCustomer = {
  id: string; name: string; docType: string | null; docNumber: string | null;
  email: string | null; phone: string | null; balance: number;
  profileTypeId: string | null; profileName: string | null; priceListId: string | null;
};

function shapeCustomer(c: {
  id: string; name: string; doc_type: string | null; doc_number: string | null;
  email: string | null; phone: string | null; balance: number; customer_types: unknown;
}): ShapedCustomer {
  const ct = (Array.isArray(c.customer_types) ? c.customer_types[0] : c.customer_types) as
    { id: string; name: string; price_list_id: string | null } | null;
  return {
    id: c.id, name: c.name, docType: c.doc_type, docNumber: c.doc_number,
    email: c.email, phone: c.phone, balance: Number(c.balance),
    profileTypeId: ct?.id ?? null, profileName: ct?.name ?? null, priceListId: ct?.price_list_id ?? null,
  };
}

const CUSTOMER_SEL = "id, name, doc_type, doc_number, email, phone, balance, customer_types(id, name, price_list_id)";

/** Busca un cliente por documento (DNI/CUIT) para el flujo mayorista. */
export async function buscarClientePorDoc(doc: string): Promise<ShapedCustomer | null> {
  const clean = doc.trim();
  if (!clean) return null;
  const sb = await createClient();
  const { data } = await sb.from("customers").select(CUSTOMER_SEL).eq("doc_number", clean).eq("active", true).limit(1).maybeSingle();
  return data ? shapeCustomer(data) : null;
}

/** Crea un cliente mayorista rápido desde el POS y lo devuelve listo para usar. */
export async function crearClienteRapido(input: {
  docType: string; docNumber: string; name: string; customerTypeId: string; email?: string; phone?: string;
}): Promise<{ ok: true; customer: ShapedCustomer } | { ok: false; error: string }> {
  const denied = await requireCan("pos", true);
  if (denied) return { ok: false, error: denied.error ?? "Sin permiso" };
  const name = input.name.trim();
  const doc = input.docNumber.trim();
  if (!name) return { ok: false, error: "Ingresá el nombre" };
  if (!doc) return { ok: false, error: "Ingresá el documento" };
  if (!input.customerTypeId) return { ok: false, error: "Elegí un perfil" };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { ok: false, error: "Sin organización" };

  const { data: ct } = await sb.from("customer_types").select("default_fiscal_condition").eq("id", input.customerTypeId).maybeSingle();

  const { data, error } = await sb.from("customers").insert({
    organization_id: orgId, name, customer_type_id: input.customerTypeId,
    doc_type: input.docType || "DNI", doc_number: doc,
    email: input.email?.trim() || null, phone: input.phone?.trim() || null,
    fiscal_condition: ct?.default_fiscal_condition ?? "responsable_inscripto",
  }).select(CUSTOMER_SEL).single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, customer: shapeCustomer(data) };
}

const schema = z.object({
  storeId: z.string().uuid(),
  cashSessionId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  priceListId: z.string().uuid().nullable(),
  couponId: z.string().uuid().nullable(),
  customerData: z.object({
    name: z.string().trim().optional(),
    doc: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    email: z.string().trim().optional(),
  }).nullable(),
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

export async function crearVenta(input: CrearVentaInput): Promise<ActionState & { number?: number; id?: string }> {
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
    p_coupon_id: d.couponId,
    p_customer_data: d.customerData ?? null,
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
  return { ok: true, number: sale?.number, id: id as string };
}
