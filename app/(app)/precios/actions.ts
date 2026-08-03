"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

function relName(r: unknown): string {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? "";
}

export type PrecioRow = { id: string; producto: string; categoria: string; precio: number | "" };

/** Devuelve todos los productos con su precio en la lista (para exportar a Excel). */
export async function exportarPrecios(listId: string): Promise<{ error?: string; rows?: PrecioRow[] }> {
  const denied = await requireCan("precios", true);
  if (denied) return { error: denied.error };

  const sb = await createClient();

  const products: { id: string; name: string; categories: unknown }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("products").select("id, name, categories(name)").order("name").range(from, from + 999);
    if (!data || data.length === 0) break;
    products.push(...data);
    if (data.length < 1000) break;
  }

  const priceMap = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("price_list_items").select("product_id, price").eq("price_list_id", listId).is("variant_id", null).range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) priceMap.set(r.product_id, Number(r.price));
    if (data.length < 1000) break;
  }

  return {
    rows: products.map((p) => ({ id: p.id, producto: p.name, categoria: relName(p.categories), precio: priceMap.get(p.id) ?? "" })),
  };
}

const importSchema = z.array(z.object({
  id: z.string().uuid(),
  precio: z.coerce.number().min(0),
}));

/** Bulk: setea el precio de la lista para los productos del Excel. */
export async function importarPrecios(listId: string, rawRows: unknown): Promise<ActionState & { count?: number }> {
  const denied = await requireCan("precios", true);
  if (denied) return denied;

  const parsed = importSchema.safeParse(rawRows);
  if (!parsed.success) return { error: "El archivo no tiene el formato esperado (columnas id y precio)." };
  const rows = parsed.data;
  if (rows.length === 0) return { error: "No hay filas con precio válido para importar." };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  const ids = rows.map((r) => r.id);
  // Limpio los precios de producto previos de estos productos en la lista, en chunks.
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await sb.from("price_list_items").delete().eq("price_list_id", listId).is("variant_id", null).in("product_id", chunk);
    if (error) return { error: error.message };
  }
  // Inserto los nuevos, en chunks.
  const items = rows.map((r) => ({ organization_id: orgId, price_list_id: listId, product_id: r.id, variant_id: null, price: r.precio }));
  for (let i = 0; i < items.length; i += 500) {
    const { error } = await sb.from("price_list_items").insert(items.slice(i, i + 500));
    if (error) return { error: error.message };
  }

  revalidatePath("/precios");
  return { ok: true, count: rows.length };
}

export async function crearLista(name: string): Promise<ActionState> {
  const denied = await requireCan("precios", true);
  if (denied) return denied;
  const clean = name.trim();
  if (!clean) return { error: "Ingresá un nombre" };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  const { error } = await sb.from("price_lists").insert({ organization_id: orgId, name: clean });
  if (error) {
    if (error.code === "23505") return { error: "Ya existe una lista con ese nombre" };
    return { error: error.message };
  }
  revalidatePath("/precios");
  return { ok: true };
}
