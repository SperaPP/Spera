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

// ── Métodos de despacho (logística) ────────────────────────────
export async function crearMetodoDespacho(name: string): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const clean = name.trim();
  if (!clean) return { error: "Ingresá un nombre" };
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  const { error } = await sb.from("shipping_methods").insert({ organization_id: orgId, name: clean, position: 99 });
  if (error) return { error: error.code === "23505" ? "Ya existe un método con ese nombre" : error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function toggleMetodoDespacho(id: string, active: boolean): Promise<ActionState> {
  const denied = await requireCan("configuracion", true);
  if (denied) return denied;
  const sb = await createClient();
  const { error } = await sb.from("shipping_methods").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/configuracion");
  return { ok: true };
}

// ── Precios ────────────────────────────────────────────────────
// Recalcula Publico (= Mayorista × 2) para todos los productos con Mayorista cargado.
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
