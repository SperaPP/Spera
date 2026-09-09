"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

const schema = z.object({
  warehouseId: z.string().uuid(),
  counts: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(0) })).min(1, "No hay nada para cargar"),
});

/** Suma las cantidades escaneadas al stock actual del depósito (no lo reemplaza). */
export async function aplicarStockInicial(input: z.infer<typeof schema>): Promise<ActionState & { count?: number }> {
  const denied = await requireCan("control_stock", true);
  if (denied) return denied;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const rows = parsed.data.counts.filter((c) => c.quantity > 0);
  if (rows.length === 0) return { error: "No escaneaste ninguna unidad para sumar." };

  const sb = await createClient();
  const { data, error } = await sb.rpc("apply_stock_initial", {
    p_warehouse_id: parsed.data.warehouseId,
    p_counts: rows.map((c) => ({ variant_id: c.variantId, quantity: c.quantity })),
  });
  if (error) return { error: error.message };
  revalidatePath("/stock");
  return { ok: true, count: (data as number) ?? 0 };
}
