"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalCustomer } from "@/lib/portal";
import { centralWarehouseId, portalProduct, type PortalProduct } from "@/lib/portal-catalog";
import type { ActionState } from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Registro de un cliente mayorista en el portal. Queda pendiente de aprobación. */
export async function registrarPortal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const docType = String(formData.get("docType") ?? "DNI").trim();
  const docNumber = String(formData.get("docNumber") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!name) return { error: "Ingresá la razón social o nombre." };
  if (!EMAIL_RE.test(email)) return { error: "Email inválido." };
  if (!docNumber) return { error: "Ingresá el DNI/CUIT." };
  if (password.length < 6) return { error: "La contraseña debe tener al menos 6 caracteres." };

  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!org) return { error: "No se pudo registrar (sin organización)." };

  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { portal: "true", full_name: name },
  });
  if (error) return { error: error.message.includes("already") ? "Ya existe una cuenta con ese email." : error.message };
  const uid = created.user?.id;
  if (!uid) return { error: "No se pudo crear la cuenta." };

  const { error: cErr } = await admin.from("customers").insert({
    organization_id: org.id, name, doc_type: docType, doc_number: docNumber,
    email, phone: phone || null, auth_user_id: uid, portal_status: "pendiente", active: true,
  });
  if (cErr) {
    // Rollback del auth user si el cliente no se pudo crear.
    await admin.auth.admin.deleteUser(uid);
    return { error: cErr.message };
  }

  const sb = await createClient();
  await sb.auth.signInWithPassword({ email, password });
  redirect("/portal");
}

export async function loginPortal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Ingresá email y contraseña." };
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: "Email o contraseña incorrectos." };
  redirect("/portal");
}

/** Confirma el pedido del portal: crea la venta, descuenta stock y va a cuenta corriente. */
export async function crearPedidoPortal(
  items: { variantId: string; quantity: number }[]
): Promise<ActionState & { saleId?: string; number?: number }> {
  const { customer } = await getPortalCustomer();
  if (!customer || customer.portalStatus !== "aprobado") return { error: "No autorizado." };
  const clean = (items ?? []).filter((i) => i.variantId && i.quantity > 0);
  if (!clean.length) return { error: "El pedido está vacío." };

  const sb = await createClient(); // cliente con cookie → auth.uid() = cliente del portal
  const { data: saleId, error } = await sb.rpc("portal_create_order", {
    p_customer: customer.id,
    p_items: clean.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
  });
  if (error) return { error: error.message };

  const admin = createAdminClient();
  const { data: s } = await admin.from("sales").select("number").eq("id", saleId as string).maybeSingle();
  return { ok: true, saleId: saleId as string, number: s?.number ?? undefined };
}

export async function logoutPortal() {
  const sb = await createClient();
  await sb.auth.signOut();
  redirect("/portal/login");
}

/** Stock DISPONIBLE actual (Central) para las variantes del carrito. Solo lectura;
 *  el portal-cart lo usa para re-validar contra el stock vivo. */
export async function stockDisponiblePortal(variantIds: string[]): Promise<Record<string, number>> {
  const { customer } = await getPortalCustomer();
  if (!customer || !variantIds.length) return {};
  const wh = await centralWarehouseId();
  if (!wh) return {};
  const admin = createAdminClient();
  const out: Record<string, number> = {};
  for (const v of variantIds) out[v] = 0;
  const { data } = await admin.from("stock").select("variant_id, quantity, reserved")
    .eq("warehouse_id", wh).in("variant_id", variantIds.slice(0, 300));
  for (const s of data ?? []) out[s.variant_id] = Math.max(0, Number(s.quantity) - Number(s.reserved ?? 0));
  return out;
}

/** Trae un producto (con variantes + stock) para el quick-add del catálogo. */
export async function productoPortal(id: string): Promise<PortalProduct | null> {
  const { customer } = await getPortalCustomer();
  if (!customer?.priceListId || !customer.organizationId) return null;
  const wh = await centralWarehouseId();
  if (!wh) return null;
  return portalProduct(id, customer.organizationId, customer.priceListId, wh);
}
