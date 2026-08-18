"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCan, type ActionState } from "@/lib/auth";

// Whitelist: el cliente manda un "kind", nunca un nombre de tabla crudo.
const TABLES = {
  categorias: "categories",
  colores: "colors",
  telas: "fabric_types",
  talles: "sizes",
} as const;
export type CatalogKind = keyof typeof TABLES;

export async function agregarCatalogo(kind: CatalogKind, name: string): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const table = TABLES[kind];
  if (!table) return { error: "Catálogo inválido" };
  const clean = name.trim();
  if (!clean) return { error: "Ingresá un nombre" };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  const row: Record<string, unknown> = { organization_id: orgId, name: clean };
  if (table === "sizes") row.position = 999;

  const { error } = await sb.from(table).insert(row);
  if (error) {
    if (error.code === "23505") return { error: "Ya existe un ítem con ese nombre" };
    return { error: error.message };
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function toggleCatalogo(kind: CatalogKind, id: string, active: boolean): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const table = TABLES[kind];
  if (!table) return { error: "Catálogo inválido" };

  const sb = await createClient();
  const { error } = await sb.from(table).update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

// ── Medios de pago ─────────────────────────────────────────────
export async function crearMedioPago(name: string, kind: string): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const clean = name.trim();
  if (!clean) return { error: "Ingresá un nombre" };
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  const { error } = await sb.from("payment_methods").insert({ organization_id: orgId, name: clean, kind: kind || "otro" });
  if (error) return { error: error.code === "23505" ? "Ya existe un medio con ese nombre" : error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function toggleMedioPago(id: string, active: boolean): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.from("payment_methods").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function setRecargoMedio(id: string, surcharge: number): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  if (!isFinite(surcharge) || surcharge < 0) return { error: "Recargo inválido" };
  const sb = await createClient();
  const { error } = await sb.from("payment_methods").update({ surcharge_pct: surcharge }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

// ── Tipos de cliente ↔ lista de precios ────────────────────────
export async function asignarListaTipo(typeId: string, priceListId: string | null): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.from("customer_types").update({ price_list_id: priceListId || null }).eq("id", typeId);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function crearTipoCliente(name: string, priceListId: string | null, fiscal: string): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const clean = name.trim();
  if (!clean) return { error: "Ingresá un nombre" };
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  const { error } = await sb.from("customer_types").insert({
    organization_id: orgId, name: clean, price_list_id: priceListId || null,
    default_fiscal_condition: fiscal || "consumidor_final",
  });
  if (error) return { error: error.code === "23505" ? "Ya existe un tipo con ese nombre" : error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

// ── Depósitos ──────────────────────────────────────────────────
export async function crearDeposito(name: string): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const clean = name.trim();
  if (!clean) return { error: "Ingresá un nombre" };
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  const { error } = await sb.from("warehouses").insert({ organization_id: orgId, name: clean });
  if (error) return { error: error.code === "23505" ? "Ya existe un depósito con ese nombre" : error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function toggleDeposito(id: string, active: boolean): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.from("warehouses").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

// ── Locales (puntos de venta) ─────────────────────────────────
export async function crearLocal(name: string, warehouseId: string, hasCash: boolean): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const clean = name.trim();
  if (!clean) return { error: "Ingresá un nombre" };
  if (!warehouseId) return { error: "Elegí un depósito" };
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  const { error } = await sb.from("stores").insert({
    organization_id: orgId, name: clean, warehouse_id: warehouseId, type: "fisico", has_cash_register: hasCash,
  });
  if (error) return { error: error.code === "23505" ? "Ya existe un local con ese nombre" : error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function toggleLocal(id: string, active: boolean): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.from("stores").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

// ── Reglas de precios ──────────────────────────────────────────
// Guarda (o borra) la regla de una categoría. category_id null = regla general.
// pubMarkup null en una categoría = "usa la regla general" → borra el override.
export async function setReglaPrecio(
  categoryId: string | null,
  pubMarkup: number | null,
  mayDiscount: number | null
): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  // Categoría sin override → borrar la regla propia (vuelve a la general).
  if (categoryId && pubMarkup == null) {
    const { error } = await sb.from("pricing_rules").delete().eq("organization_id", orgId).eq("category_id", categoryId);
    if (error) return { error: error.message };
    revalidatePath("/configuracion");
    return { ok: true };
  }

  if (pubMarkup == null || !isFinite(pubMarkup) || pubMarkup < 0) return { error: "Markup inválido" };
  const disc = mayDiscount ?? 50;
  if (!isFinite(disc) || disc < 0 || disc > 100) return { error: "Descuento inválido (0–100)" };

  const row = {
    organization_id: orgId as string,
    category_id: categoryId,
    publico_markup_pct: pubMarkup,
    mayorista_discount_pct: disc,
    updated_at: new Date().toISOString(),
  };

  // Upsert manual por (org, category_id); category_id null = regla general.
  const base = sb.from("pricing_rules").select("id").eq("organization_id", orgId);
  const found = await (categoryId === null
    ? base.is("category_id", null)
    : base.eq("category_id", categoryId)
  ).maybeSingle();

  const { error } = found.data
    ? await sb.from("pricing_rules").update(row).eq("id", found.data.id)
    : await sb.from("pricing_rules").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function recalcularPrecios(): Promise<ActionState & { count?: number }> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const sb = await createClient();
  const { data, error } = await sb.rpc("recalc_all_pricing");
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  revalidatePath("/precios");
  return { ok: true, count: (data as number) ?? 0 };
}

export async function inicializarPrecios(): Promise<ActionState & { count?: number }> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const sb = await createClient();
  const { data, error } = await sb.rpc("seed_pricing_from_current");
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  revalidatePath("/precios");
  return { ok: true, count: (data as number) ?? 0 };
}

// ── Cupones (solo perfil con acceso a Configuración) ───────────
export async function crearCupon(input: {
  code: string; discountType: "percent" | "amount"; discountValue: number;
  minAmount: number | null; maxUses: number | null; expiresAt: string | null;
}): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const code = input.code.trim().toUpperCase();
  if (!code) return { error: "Ingresá un código" };
  if (!isFinite(input.discountValue) || input.discountValue <= 0) return { error: "Valor de descuento inválido" };
  if (input.discountType === "percent" && input.discountValue > 100) return { error: "El porcentaje no puede superar 100" };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  const { error } = await sb.from("coupons").insert({
    organization_id: orgId,
    code,
    discount_type: input.discountType,
    discount_value: input.discountValue,
    min_amount: input.minAmount,
    max_uses: input.maxUses,
    expires_at: input.expiresAt || null,
  });
  if (error) return { error: error.code === "23505" ? "Ya existe un cupón con ese código" : error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function toggleCupon(id: string, active: boolean): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.from("coupons").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}
