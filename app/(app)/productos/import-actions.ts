"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

const lbl = (s: string | null, c: string | null) => [s, c].filter(Boolean).join(" / ");
function rel<T>(r: unknown): T | null { return (Array.isArray(r) ? r[0] : r) as T | null; }

/** Todas las variantes (sku + producto + variante), paginado. */
async function allVariants(sb: Awaited<ReturnType<typeof createClient>>): Promise<{ id: string; sku: string | null; producto: string; variante: string; loc_fila: number | null; loc_estante: number | null; loc_cubiculo: number | null }[]> {
  const out: { id: string; sku: string | null; producto: string; variante: string; loc_fila: number | null; loc_estante: number | null; loc_cubiculo: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("product_variants")
      .select("id, sku, size, color, loc_fila, loc_estante, loc_cubiculo, products(name)")
      .order("sku").range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const v of data) {
      out.push({ id: v.id, sku: v.sku, producto: rel<{ name: string }>(v.products)?.name ?? "", variante: lbl(v.size, v.color),
        loc_fila: v.loc_fila, loc_estante: v.loc_estante, loc_cubiculo: v.loc_cubiculo });
    }
    if (data.length < 1000) break;
  }
  return out;
}

// ── STOCK ──────────────────────────────────────────────────────
export type StockRow = { sku: string; producto: string; variante: string; cantidad: number | "" };

export async function exportarStock(warehouseId: string): Promise<{ error?: string; rows?: StockRow[] }> {
  const denied = await requireCan("stock", true);
  if (denied) return { error: denied.error };
  if (!warehouseId) return { error: "Elegí el depósito." };
  const sb = await createClient();
  const vars = await allVariants(sb);

  const stockMap = new Map<string, number>();
  const ids = vars.map((v) => v.id);
  for (let i = 0; i < ids.length; i += 1000) {
    const { data } = await sb.from("stock").select("variant_id, quantity").eq("warehouse_id", warehouseId).in("variant_id", ids.slice(i, i + 1000));
    for (const s of data ?? []) stockMap.set(s.variant_id, Number(s.quantity));
  }
  return { rows: vars.filter((v) => v.sku).map((v) => ({ sku: v.sku!, producto: v.producto, variante: v.variante, cantidad: stockMap.get(v.id) ?? 0 })) };
}

const stockSchema = z.array(z.object({ sku: z.string().trim().min(1), cantidad: z.coerce.number().min(0) }));

export async function importarStock(warehouseId: string, raw: unknown): Promise<ActionState & { count?: number }> {
  const denied = await requireCan("stock", true);
  if (denied) return denied;
  if (!warehouseId) return { error: "Elegí el depósito." };
  const parsed = stockSchema.safeParse(raw);
  if (!parsed.success) return { error: "El archivo no tiene el formato esperado (columnas sku y cantidad)." };
  const rows = parsed.data;
  if (rows.length === 0) return { error: "No hay filas válidas para importar." };

  const sb = await createClient();
  let count = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000).map((r) => ({ sku: r.sku, cantidad: r.cantidad }));
    const { data, error } = await sb.rpc("import_stock", { p_warehouse: warehouseId, p_rows: chunk });
    if (error) return { error: error.message };
    count += (data as number) ?? 0;
  }
  return { ok: true, count };
}

// ── UBICACIONES ────────────────────────────────────────────────
export type UbicRow = { sku: string; producto: string; variante: string; fila: number | ""; estante: number | ""; cubiculo: number | "" };

export async function exportarUbicaciones(): Promise<{ error?: string; rows?: UbicRow[] }> {
  const denied = await requireCan("productos", true);
  if (denied) return { error: denied.error };
  const sb = await createClient();
  const vars = await allVariants(sb);
  return { rows: vars.filter((v) => v.sku).map((v) => ({
    sku: v.sku!, producto: v.producto, variante: v.variante,
    fila: v.loc_fila ?? "", estante: v.loc_estante ?? "", cubiculo: v.loc_cubiculo ?? "",
  })) };
}

const ubicSchema = z.array(z.object({
  sku: z.string().trim().min(1),
  fila: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  estante: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  cubiculo: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
}));

export async function importarUbicaciones(raw: unknown): Promise<ActionState & { count?: number }> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const parsed = ubicSchema.safeParse(raw);
  if (!parsed.success) return { error: "El archivo no tiene el formato esperado (sku, fila, estante, cubiculo)." };
  const rows = parsed.data;
  if (rows.length === 0) return { error: "No hay filas para importar." };

  const sb = await createClient();
  let count = 0;
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000).map((r) => ({
      sku: r.sku,
      fila: r.fila === "" || r.fila == null ? "" : String(r.fila),
      estante: r.estante === "" || r.estante == null ? "" : String(r.estante),
      cubiculo: r.cubiculo === "" || r.cubiculo == null ? "" : String(r.cubiculo),
    }));
    const { data, error } = await sb.rpc("import_ubicaciones", { p_rows: chunk });
    if (error) return { error: error.message };
    count += (data as number) ?? 0;
  }
  return { ok: true, count };
}
