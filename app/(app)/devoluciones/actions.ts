"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

/** Busca la variante por código y valida la regla de 30 días para ese cliente. */
export async function verificarItem(customerId: string, code: string) {
  const c = code.trim();
  if (!customerId) return { ok: false as const, reason: "Elegí un cliente primero." };
  if (!c) return { ok: false as const, reason: "Código vacío." };

  const sb = await createClient();
  const sel = "id, size, color, sku, product_id, products(name)";
  let { data: v } = await sb.from("product_variants").select(sel).eq("barcode", c).limit(1).maybeSingle();
  if (!v) ({ data: v } = await sb.from("product_variants").select(sel).eq("sku", c).limit(1).maybeSingle());
  if (!v) return { ok: false as const, reason: `Código ${c}: sin resultados.` };

  const prod = v.products as unknown;
  const name = (Array.isArray(prod) ? prod[0]?.name : (prod as { name: string } | null)?.name) ?? "";
  const label = [v.size, v.color].filter(Boolean).join(" / ") || null;

  const { data: elig } = await sb.rpc("check_return_eligibility", { p_customer: customerId, p_variant: v.id });
  const e = elig as { eligible: boolean; unit_price?: number; last_date?: string } | null;
  if (!e?.eligible) return { ok: false as const, reason: `${name} — este cliente no la compró en los últimos 30 días.` };

  return { ok: true as const, variantId: v.id, name, label, unitPrice: Number(e.unit_price), lastDate: e.last_date ?? null };
}

const schema = z.object({
  customerId: z.string().uuid(),
  storeId: z.string().uuid(),
  notes: z.string().trim().optional(),
  items: z.array(z.object({
    variantId: z.string().uuid(),
    productName: z.string(),
    variantLabel: z.string().nullable(),
    quantity: z.number().int().positive(),
  })).min(1, "Agregá al menos un ítem"),
});

export type CrearDevolucionInput = z.infer<typeof schema>;

export async function crearDevolucion(input: CrearDevolucionInput): Promise<ActionState & { number?: number }> {
  const denied = await requireCan("devoluciones", true);
  if (denied) return denied;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const { data: id, error } = await sb.rpc("create_return", {
    p_customer: d.customerId,
    p_store_id: d.storeId,
    p_items: d.items.map((i) => ({ variant_id: i.variantId, product_name: i.productName, variant_label: i.variantLabel, quantity: i.quantity })),
    p_notes: d.notes ?? null,
  });
  if (error) return { error: error.message };

  const { data: ret } = await sb.from("returns").select("number").eq("id", id as string).single();
  revalidatePath("/devoluciones");
  return { ok: true, number: ret?.number };
}

export async function aprobarDevolucion(id: string): Promise<ActionState> {
  const denied = await requireCan("devoluciones", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.rpc("approve_return", { p_return_id: id });
  if (error) return { error: error.message };
  revalidatePath("/devoluciones");
  return { ok: true };
}

export async function rechazarDevolucion(id: string): Promise<ActionState> {
  const denied = await requireCan("devoluciones", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.rpc("reject_return", { p_return_id: id });
  if (error) return { error: error.message };
  revalidatePath("/devoluciones");
  return { ok: true };
}
