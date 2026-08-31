"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, requireAdmin, type ActionState } from "@/lib/auth";

/** Busca la variante por código y devuelve su stock disponible en el depósito origen. */
export async function buscarVarianteTransferencia(code: string, fromWarehouseId: string) {
  const c = code.trim();
  if (!c) return { ok: false as const, reason: "Código vacío." };
  if (!fromWarehouseId) return { ok: false as const, reason: "Elegí el depósito de origen." };

  const sb = await createClient();
  const sel = "id, size, color, product_id, products(name)";
  let { data: v } = await sb.from("product_variants").select(sel).eq("barcode", c).limit(1).maybeSingle();
  if (!v) ({ data: v } = await sb.from("product_variants").select(sel).eq("sku", c).limit(1).maybeSingle());
  if (!v) return { ok: false as const, reason: `Código ${c}: sin resultados.` };

  const { data: st } = await sb
    .from("stock")
    .select("quantity, reserved")
    .eq("warehouse_id", fromWarehouseId)
    .eq("variant_id", v.id)
    .maybeSingle();

  const prod = v.products as unknown;
  const name = (Array.isArray(prod) ? prod[0]?.name : (prod as { name: string } | null)?.name) ?? "";
  const label = [v.size, v.color].filter(Boolean).join(" / ") || null;

  // Disponible = físico − reservado: no se transfiere mercadería comprometida por un pedido.
  const available = Number(st?.quantity ?? 0) - Number(st?.reserved ?? 0);
  return { ok: true as const, variantId: v.id, name, label, available: Math.max(0, available) };
}

const schema = z.object({
  fromWh: z.string().uuid(),
  toWh: z.string().uuid(),
  notes: z.string().trim().optional(),
  items: z.array(z.object({
    variantId: z.string().uuid(),
    productName: z.string(),
    quantity: z.number().int().positive(),
  })).min(1, "Agregá al menos un ítem"),
}).refine((d) => d.fromWh !== d.toWh, { message: "El origen y el destino deben ser distintos" });

export type CrearTransferenciaInput = z.infer<typeof schema>;

export async function crearTransferencia(input: CrearTransferenciaInput): Promise<ActionState & { id?: string }> {
  const denied = await requireCan("transferencias", true);
  if (denied) return denied;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const { data, error } = await sb.rpc("create_transfer", {
    p_from: d.fromWh,
    p_to: d.toWh,
    p_items: d.items.map((i) => ({ variant_id: i.variantId, product_name: i.productName, quantity: i.quantity })),
    p_notes: d.notes ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/transferencias");
  revalidatePath("/logistica");
  return { ok: true, id: data as string };
}

const editSchema = z.array(z.object({
  variantId: z.string().uuid(),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
}));

/** Edita los ítems de una transferencia 'creada' (solo admin). La RPC edit_transfer
 *  libera la reserva vieja y reserva los ítems nuevos en el origen. */
export async function editarTransferencia(id: string, items: unknown): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const parsed = editSchema.safeParse(items);
  if (!parsed.success) return { error: "Ítems inválidos" };
  if (parsed.data.length === 0) return { error: "La transferencia no puede quedar sin ítems" };

  const sb = await createClient();
  const { error } = await sb.rpc("edit_transfer", {
    p_transfer_id: id,
    p_items: parsed.data.map((i) => ({ variant_id: i.variantId, product_name: i.productName, quantity: i.quantity })),
  });
  if (error) return { error: error.message };

  revalidatePath("/transferencias");
  revalidatePath(`/transferencias/${id}`);
  revalidatePath("/logistica");
  return { ok: true };
}

export async function enviarTransferencia(id: string): Promise<ActionState> {
  const denied = await requireCan("transferencias", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.rpc("send_transfer", { p_transfer_id: id });
  if (error) return { error: error.message };
  revalidatePath("/transferencias");
  revalidatePath(`/transferencias/${id}`);
  revalidatePath("/logistica");
  return { ok: true };
}

export async function recibirTransferencia(id: string): Promise<ActionState> {
  const denied = await requireCan("transferencias", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.rpc("receive_transfer", { p_transfer_id: id });
  if (error) return { error: error.message };
  revalidatePath("/transferencias");
  revalidatePath(`/transferencias/${id}`);
  revalidatePath("/logistica");
  return { ok: true };
}

export async function cancelarTransferencia(id: string): Promise<ActionState> {
  const denied = await requireCan("transferencias", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.rpc("cancel_transfer", { p_transfer_id: id });
  if (error) return { error: error.message };
  revalidatePath("/transferencias");
  revalidatePath(`/transferencias/${id}`);
  revalidatePath("/logistica");
  return { ok: true };
}

/** Busca productos por NOMBRE y devuelve sus variantes con disponible en el origen.
 *  Para planificar la transferencia sin tener las prendas físicas (sin SKU). */
export async function buscarProductosTransferencia(query: string, fromWarehouseId: string) {
  const q = (query ?? "").trim();
  if (q.length < 2 || !fromWarehouseId) return [];
  const sb = await createClient();

  const { data: prods } = await sb.from("products").select("id, name").ilike("name", `%${q}%`).eq("active", true).order("name").limit(15);
  const ids = (prods ?? []).map((p) => p.id);
  if (!ids.length) return [];

  const { data: vars } = await sb.from("product_variants").select("id, size, color, product_id").in("product_id", ids).eq("active", true);
  const varIds = (vars ?? []).map((v) => v.id);
  const availByVar = new Map<string, number>();
  for (let i = 0; i < varIds.length; i += 200) {
    const { data: st } = await sb.from("stock").select("variant_id, quantity, reserved").eq("warehouse_id", fromWarehouseId).in("variant_id", varIds.slice(i, i + 200));
    for (const s of st ?? []) availByVar.set(s.variant_id, Math.max(0, Number(s.quantity) - Number(s.reserved ?? 0)));
  }

  const byProduct = new Map<string, { id: string; name: string; variants: { variantId: string; label: string | null; available: number }[] }>();
  for (const p of prods ?? []) byProduct.set(p.id, { id: p.id, name: p.name, variants: [] });
  for (const v of vars ?? []) {
    const avail = availByVar.get(v.id) ?? 0;
    if (avail <= 0) continue; // solo lo que hay en el origen (transferible)
    const l = [v.size, v.color].filter(Boolean).join(" / ") || null;
    byProduct.get(v.product_id)?.variants.push({ variantId: v.id, label: l, available: avail });
  }
  return [...byProduct.values()]
    .filter((p) => p.variants.length)
    .map((p) => ({ ...p, variants: p.variants.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? "", "es")) }));
}
