"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

function relName(r: unknown): string {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? "";
}

export type PrecioRow = { id: string; producto: string; categoria: string; precio: number | ""; promo: number | "" };

/** Devuelve todos los productos con su precio y promo en la lista (para exportar a Excel). */
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
  const promoMap = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("price_list_items").select("product_id, price, promo_price").eq("price_list_id", listId).is("variant_id", null).range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      priceMap.set(r.product_id, Number(r.price));
      if (r.promo_price != null) promoMap.set(r.product_id, Number(r.promo_price));
    }
    if (data.length < 1000) break;
  }

  return {
    rows: products.map((p) => ({
      id: p.id, producto: p.name, categoria: relName(p.categories),
      precio: priceMap.get(p.id) ?? "", promo: promoMap.get(p.id) ?? "",
    })),
  };
}

const importSchema = z.array(z.object({
  id: z.string().uuid(),
  precio: z.coerce.number().min(0),
  // null = borrar promo; undefined = no tocar (depende de si el Excel trae la columna).
  promo: z.union([z.coerce.number().min(0), z.null()]).optional(),
}));

/** Bulk: setea el precio (y opcionalmente la promo) de la lista para los productos
 *  del Excel. `promoPresent` indica si el archivo trae la columna promo:
 *   - sin columna → las promos NO se tocan (se preservan las cargadas).
 *   - con columna → valor = setea promo; celda vacía = borra la promo. */
export async function importarPrecios(listId: string, rawRows: unknown, promoPresent: boolean): Promise<ActionState & { count?: number }> {
  const denied = await requireCan("precios", true);
  if (denied) return denied;

  const parsed = importSchema.safeParse(rawRows);
  if (!parsed.success) return { error: "El archivo no tiene el formato esperado (columnas id y precio)." };
  const rows = parsed.data;
  if (rows.length === 0) return { error: "No hay filas con precio válido para importar." };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  const { data: list } = await sb.from("price_lists").select("name").eq("id", listId).maybeSingle();
  const isMayorista = list?.name === "Mayorista";

  const ids = rows.map((r) => r.id);

  // Si el Excel NO trae la columna promo, preservo las promos ya cargadas: las leo
  // antes de borrar los items y las vuelvo a insertar con el precio nuevo.
  const keepPromo = new Map<string, number>();
  if (!promoPresent) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb.from("price_list_items").select("product_id, promo_price").eq("price_list_id", listId).is("variant_id", null).in("product_id", ids.slice(i, i + 200));
      for (const r of data ?? []) if (r.promo_price != null) keepPromo.set(r.product_id, Number(r.promo_price));
    }
  }

  // Limpio los precios de producto previos de estos productos en la lista, en chunks.
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await sb.from("price_list_items").delete().eq("price_list_id", listId).is("variant_id", null).in("product_id", chunk);
    if (error) return { error: error.message };
  }
  // Inserto los nuevos (con promo según corresponda), en chunks.
  const items = rows.map((r) => {
    const promo = promoPresent ? (r.promo ?? null) : (keepPromo.get(r.id) ?? null);
    return { organization_id: orgId, price_list_id: listId, product_id: r.id, variant_id: null, price: r.precio, promo_price: promo };
  });
  for (let i = 0; i < items.length; i += 500) {
    const { error } = await sb.from("price_list_items").insert(items.slice(i, i + 500));
    if (error) return { error: error.message };
  }

  // Al importar Mayorista, inicializo Publico (= × 2) SOLO en productos que aún no lo tienen.
  if (isMayorista) {
    for (const id of ids) await sb.rpc("apply_product_pricing", { p_product_id: id });
  }

  revalidatePath("/precios");
  return { ok: true, count: rows.length };
}

/** Fuerza Publico = Mayorista × 2 para todos los productos con Mayorista cargado.
 *  Pisa el Publico manual: es la re-derivación en masa a pedido (botón). */
export async function recalcularPublico(): Promise<ActionState & { count?: number }> {
  const denied = await requireCan("precios", true);
  if (denied) return denied;
  const sb = await createClient();
  const { data, error } = await sb.rpc("recalc_all_pricing");
  if (error) return { error: error.message };
  revalidatePath("/precios");
  return { ok: true, count: (data as number) ?? 0 };
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
