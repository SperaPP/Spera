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

  // Se trae TODO el stock del depósito paginado (no con .in por variante: con
  // catálogos grandes la URL se pasa del límite y volvía vacío → stock 0).
  const stockMap = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("stock").select("variant_id, quantity").eq("warehouse_id", warehouseId).range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const s of data) stockMap.set(s.variant_id, Number(s.quantity));
    if (data.length < 1000) break;
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

// ── EXPORT COMPLETO DE PRODUCTOS ───────────────────────────────
const VARIATION_LABEL: Record<string, string> = { none: "Sin variantes", talle: "Talle", color: "Color", talle_color: "Talle y color", size_color: "Talle y color" };
const yesno = (b: boolean | null | undefined) => (b ? "Sí" : "No");

export type ProductoExportRow = {
  producto: string; descripcion: string; categoria_principal: string; categoria: string;
  temporada: string; tela: string; tipo: string; iva: number | "";
  activo: string; tiene_foto: string; destacado: string; estado: string;
  talle: string; color: string; sku: string; codigo_barras: string; variante_activa: string;
  fila: number | ""; estante: number | ""; cubiculo: number | "";
  precio_mayorista: number | ""; precio_publico: number | ""; stock: number;
};

/** Exporta TODOS los productos y variantes con todos sus datos (una fila por variante).
 *  La columna `stock` es la existencia en el depósito elegido (para editar y reimportar). */
export async function exportarProductos(warehouseId: string): Promise<{ error?: string; rows?: ProductoExportRow[] }> {
  const denied = await requireCan("productos", true);
  if (denied) return { error: denied.error };
  if (!warehouseId) return { error: "Elegí el depósito." };
  const sb = await createClient();

  // Productos con sus catálogos relacionados.
  type Prod = {
    id: string; name: string; description: string | null; active: boolean; has_image: boolean;
    featured: boolean; tax_rate: number; variation_type: string; lifecycle: string;
    categories: unknown; main_categories: unknown; seasons: unknown; fabric_types: unknown;
  };
  const prods = new Map<string, Prod>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("products")
      .select("id, name, description, active, has_image, featured, tax_rate, variation_type, lifecycle, categories(name), main_categories(name), seasons(name), fabric_types(name)")
      .order("name").range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const p of data as Prod[]) prods.set(p.id, p);
    if (data.length < 1000) break;
  }

  // Precios (Mayorista / Publico) por producto.
  const { data: lists } = await sb.from("price_lists").select("id, name").in("name", ["Mayorista", "Publico"]);
  const mayId = (lists ?? []).find((l) => l.name === "Mayorista")?.id ?? null;
  const pubId = (lists ?? []).find((l) => l.name === "Publico")?.id ?? null;
  const priceMay = new Map<string, number>(), pricePub = new Map<string, number>();
  for (const [listId, target] of [[mayId, priceMay], [pubId, pricePub]] as const) {
    if (!listId) continue;
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from("price_list_items").select("product_id, price").eq("price_list_id", listId).is("variant_id", null).range(from, from + 999);
      if (!data || data.length === 0) break;
      for (const r of data) (target as Map<string, number>).set(r.product_id, Number(r.price));
      if (data.length < 1000) break;
    }
  }

  // Variantes.
  type Var = { id: string; product_id: string; size: string | null; color: string | null; sku: string | null; barcode: string | null; active: boolean; loc_fila: number | null; loc_estante: number | null; loc_cubiculo: number | null };
  const vars: Var[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("product_variants")
      .select("id, product_id, size, color, sku, barcode, active, loc_fila, loc_estante, loc_cubiculo")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    vars.push(...(data as Var[]));
    if (data.length < 1000) break;
  }

  // Stock por variante EN EL DEPÓSITO ELEGIDO. Se trae TODO el stock del depósito
  // paginado (no con .in por variante: con catálogos grandes la URL se pasa del
  // límite y volvía vacío → stock 0).
  const stockByVar = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("stock").select("variant_id, quantity").eq("warehouse_id", warehouseId).range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const s of data) stockByVar.set(s.variant_id, Number(s.quantity));
    if (data.length < 1000) break;
  }

  const rows: ProductoExportRow[] = [];
  for (const v of vars) {
    const p = prods.get(v.product_id);
    if (!p) continue;
    rows.push({
      producto: p.name, descripcion: p.description ?? "",
      categoria_principal: rel<{ name: string }>(p.main_categories)?.name ?? "",
      categoria: rel<{ name: string }>(p.categories)?.name ?? "",
      temporada: rel<{ name: string }>(p.seasons)?.name ?? "",
      tela: rel<{ name: string }>(p.fabric_types)?.name ?? "",
      tipo: VARIATION_LABEL[p.variation_type] ?? p.variation_type,
      iva: p.tax_rate ?? "",
      activo: yesno(p.active), tiene_foto: yesno(p.has_image), destacado: yesno(p.featured),
      estado: p.lifecycle === "discontinuo" ? "Discontinuo" : "Actual",
      talle: v.size ?? "", color: v.color ?? "", sku: v.sku ?? "", codigo_barras: v.barcode ?? "",
      variante_activa: yesno(v.active),
      fila: v.loc_fila ?? "", estante: v.loc_estante ?? "", cubiculo: v.loc_cubiculo ?? "",
      precio_mayorista: priceMay.get(v.product_id) ?? "", precio_publico: pricePub.get(v.product_id) ?? "",
      stock: stockByVar.get(v.id) ?? 0,
    });
  }
  // Ordenado por producto y luego variante para que sea legible.
  rows.sort((a, b) => a.producto.localeCompare(b.producto, "es") || `${a.talle} ${a.color}`.localeCompare(`${b.talle} ${b.color}`, "es"));
  return { rows };
}

// ── ACTUALIZACIÓN MASIVA (matchea por SKU) ─────────────────────
export type UpdateRow = Record<string, string>;

/** Vista previa: cuántos SKU del archivo existen (se actualizan) y cuántos no. */
export async function previewActualizacion(skus: string[]): Promise<{ error?: string; enBase?: number; noEnBase?: number }> {
  const denied = await requireCan("productos", true);
  if (denied) return { error: denied.error };
  const sb = await createClient();
  const uniq = [...new Set(skus.map((s) => (s ?? "").trim()).filter(Boolean))];
  let enBase = 0;
  for (let i = 0; i < uniq.length; i += 500) {
    const { data } = await sb.from("product_variants").select("sku").in("sku", uniq.slice(i, i + 500));
    enBase += (data ?? []).length;
  }
  return { enBase, noEnBase: uniq.length - enBase };
}

/** Actualiza productos/variantes existentes (matchea por SKU). Celda vacía = no cambia.
 *  Si se pasa warehouseId, la columna `stock` actualiza la existencia en ese depósito. */
export async function actualizarProductos(rows: UpdateRow[], warehouseId?: string | null): Promise<ActionState & { actualizados?: number; sinMatch?: number }> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  const sb = await createClient();
  const { data, error } = await sb.rpc("update_products", { p_rows: rows, p_warehouse: warehouseId ?? null });
  if (error) return { error: error.message };
  const res = (data ?? {}) as { actualizados?: number; sin_match?: number };
  return { ok: true, actualizados: res.actualizados, sinMatch: res.sin_match };
}

// ── ALTA DE PRODUCTOS ──────────────────────────────────────────
export type ImportRow = {
  producto: string; descripcion: string;
  categoria_principal: string; categoria: string; temporada: string; tela: string;
  talle: string; color: string; sku: string;
  precio_mayorista: string; stock: string; fila: string; estante: string; cubiculo: string;
  destacado: string;
};
export type ImportPreview = {
  productos: number; variantes: number; sinProducto: number; sinSku: number;
  dupEnArchivo: string[]; dupEnBase: string[];
};

/** Vista previa (no escribe): cuenta productos/variantes y detecta SKUs repetidos. */
export async function previewProductos(rows: ImportRow[]): Promise<{ error?: string; preview?: ImportPreview }> {
  const denied = await requireCan("productos", true);
  if (denied) return { error: denied.error };
  const sb = await createClient();

  const withProd = rows.filter((r) => r.producto?.trim());
  const sinProducto = rows.length - withProd.length;
  const productos = new Set(withProd.map((r) => r.producto.trim().toLowerCase())).size;
  const variantRows = withProd.filter((r) => r.sku?.trim());
  const sinSku = withProd.length - variantRows.length;

  const seen = new Set<string>(); const dupFile = new Set<string>();
  for (const r of variantRows) { const k = r.sku.trim().toLowerCase(); if (seen.has(k)) dupFile.add(r.sku.trim()); seen.add(k); }

  const skus = [...new Set(variantRows.map((r) => r.sku.trim()))];
  const dupBase: string[] = [];
  for (let i = 0; i < skus.length; i += 500) {
    const { data } = await sb.from("product_variants").select("sku").in("sku", skus.slice(i, i + 500));
    for (const v of data ?? []) if (v.sku) dupBase.push(v.sku);
  }

  return { preview: { productos, variantes: variantRows.length, sinProducto, sinSku, dupEnArchivo: [...dupFile].slice(0, 20), dupEnBase: dupBase.slice(0, 20) } };
}

/** Crea los productos/variantes del Excel (atómico). El stock va a p_warehouse. */
export async function importarProductos(warehouseId: string, rows: ImportRow[]): Promise<ActionState & { productos?: number; variantes?: number }> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;
  if (!warehouseId) return { error: "Elegí el depósito para el stock inicial." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("import_products", { p_rows: rows, p_warehouse: warehouseId });
  if (error) return { error: error.message };
  const res = (data ?? {}) as { productos?: number; variantes?: number };
  return { ok: true, productos: res.productos, variantes: res.variantes };
}
