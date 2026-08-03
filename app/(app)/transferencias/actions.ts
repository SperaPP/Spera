"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

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
    .select("quantity")
    .eq("warehouse_id", fromWarehouseId)
    .eq("variant_id", v.id)
    .maybeSingle();

  const prod = v.products as unknown;
  const name = (Array.isArray(prod) ? prod[0]?.name : (prod as { name: string } | null)?.name) ?? "";
  const label = [v.size, v.color].filter(Boolean).join(" / ") || null;

  return { ok: true as const, variantId: v.id, name, label, available: Number(st?.quantity ?? 0) };
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

export async function crearTransferencia(input: CrearTransferenciaInput): Promise<ActionState> {
  const denied = await requireCan("transferencias", true);
  if (denied) return denied;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const { error } = await sb.rpc("create_transfer", {
    p_from: d.fromWh,
    p_to: d.toWh,
    p_items: d.items.map((i) => ({ variant_id: i.variantId, product_name: i.productName, quantity: i.quantity })),
    p_notes: d.notes ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/transferencias");
  return { ok: true };
}
