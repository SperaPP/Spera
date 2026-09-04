"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCan, requireAdmin, type ActionState } from "@/lib/auth";

const schema = z.object({
  name: z.string().trim().min(1, "Ingresá un nombre"),
  customerTypeId: z.string().uuid().nullable(),
  fiscalCondition: z.enum(["consumidor_final", "responsable_inscripto", "monotributo", "exento"]),
  docType: z.string().trim().optional(),
  docNumber: z.string().trim().optional(),
  email: z.string().trim().email("Email inválido").optional().or(z.literal("")),
  phone: z.string().trim().optional(),
});

export type CrearClienteInput = z.infer<typeof schema>;

export async function crearCliente(
  input: CrearClienteInput
): Promise<ActionState & { id?: string }> {
  const denied = await requireCan("clientes", true);
  if (denied) return denied;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  const { data, error } = await sb
    .from("customers")
    .insert({
      organization_id: orgId,
      name: d.name,
      customer_type_id: d.customerTypeId,
      fiscal_condition: d.fiscalCondition,
      doc_type: d.docType || null,
      doc_number: d.docNumber || null,
      email: d.email || null,
      phone: d.phone || null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/clientes");
  return { ok: true, id: data.id };
}

const editSchema = schema.extend({ id: z.string().uuid(), active: z.boolean() });
export type EditarClienteInput = z.infer<typeof editSchema>;

export async function editarCliente(input: EditarClienteInput): Promise<ActionState> {
  const denied = await requireCan("clientes", true);
  if (denied) return denied;

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const d = parsed.data;

  const sb = await createClient();
  const { error } = await sb.from("customers").update({
    name: d.name,
    customer_type_id: d.customerTypeId,
    fiscal_condition: d.fiscalCondition,
    doc_type: d.docType || null,
    doc_number: d.docNumber || null,
    email: d.email || null,
    phone: d.phone || null,
    active: d.active,
  }).eq("id", d.id);
  if (error) return { error: error.message };

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${d.id}`);
  return { ok: true };
}

/** Aprueba una solicitud del portal: habilita al cliente y le asigna su lista. */
export async function aprobarPortalCliente(customerId: string, customerTypeId: string | null): Promise<ActionState> {
  const denied = await requireCan("clientes", true);
  if (denied) return denied;
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  const { error } = await sb.from("customers")
    .update({ portal_status: "aprobado", customer_type_id: customerTypeId, active: true })
    .eq("id", customerId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/clientes");
  return { ok: true };
}

/** Rechaza una solicitud del portal. */
export async function rechazarPortalCliente(customerId: string): Promise<ActionState> {
  const denied = await requireCan("clientes", true);
  if (denied) return denied;
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  const { error } = await sb.from("customers").update({ portal_status: "rechazado" }).eq("id", customerId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/clientes");
  return { ok: true };
}

/** Cambia la contraseña del portal mayorista del cliente (reservado a administración). */
export async function cambiarPasswordCliente(customerId: string, newPassword: string): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!newPassword || newPassword.length < 6) return { error: "Mínimo 6 caracteres" };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  const { data: c } = await sb.from("customers").select("auth_user_id").eq("id", customerId).eq("organization_id", orgId).maybeSingle();
  if (!c) return { error: "Cliente inválido" };
  if (!c.auth_user_id) return { error: "El cliente no tiene cuenta de portal (todavía no se registró)." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(c.auth_user_id as string, { password: newPassword });
  if (error) return { error: error.message };
  return { ok: true };
}

// ── Duplicados de clientes ─────────────────────────────────────
export type DupAccount = {
  id: string; name: string; docType: string | null; docNumber: string | null;
  email: string | null; phone: string | null; balance: number;
  portalStatus: string | null; hasPortal: boolean; ventas: number; cobranzas: number; createdAt: string; active: boolean;
};
export type DupGroup = { key: string; accounts: DupAccount[] };

/** Persona detrás del documento: un CUIT (11 díg.) y su DNI (8 díg. del medio) son la misma. */
function personKey(digits: string | null): string | null {
  if (!digits) return null;
  if (digits.length === 11) return digits.slice(2, 10);
  return digits;
}

/** Detecta clientes duplicados (mismo documento / DNI↔CUIT) con su actividad. Solo admin. */
export async function analizarDuplicados(): Promise<{ error?: string; groups?: DupGroup[] }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied.error };
  const sb = await createClient();

  type C = { id: string; name: string; doc_type: string | null; doc_number: string | null; doc_digits: string | null; email: string | null; phone: string | null; balance: number; portal_status: string | null; auth_user_id: string | null; created_at: string; active: boolean };
  const all: C[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("customers").select("id, name, doc_type, doc_number, doc_digits, email, phone, balance, portal_status, auth_user_id, created_at, active").range(from, from + 999);
    if (!data || data.length === 0) break;
    all.push(...(data as C[]));
    if (data.length < 1000) break;
  }

  const byKey = new Map<string, C[]>();
  for (const c of all) { const k = personKey(c.doc_digits); if (!k) continue; const arr = byKey.get(k) ?? []; arr.push(c); byKey.set(k, arr); }
  const dupGroups = [...byKey.entries()].filter(([, arr]) => arr.length > 1);
  if (dupGroups.length === 0) return { groups: [] };

  const dupIds = dupGroups.flatMap(([, arr]) => arr.map((c) => c.id));
  const ventas = new Map<string, number>(), cobranzas = new Map<string, number>();
  for (let i = 0; i < dupIds.length; i += 300) {
    const chunk = dupIds.slice(i, i + 300);
    const [{ data: sv }, { data: rc }] = await Promise.all([
      sb.from("sales").select("customer_id").in("customer_id", chunk),
      sb.from("receipts").select("customer_id").in("customer_id", chunk),
    ]);
    for (const s of sv ?? []) if (s.customer_id) ventas.set(s.customer_id, (ventas.get(s.customer_id) ?? 0) + 1);
    for (const r of rc ?? []) if (r.customer_id) cobranzas.set(r.customer_id, (cobranzas.get(r.customer_id) ?? 0) + 1);
  }

  const groups: DupGroup[] = dupGroups.map(([key, arr]) => ({
    key,
    accounts: arr.map((c) => ({
      id: c.id, name: c.name, docType: c.doc_type, docNumber: c.doc_number,
      email: c.email, phone: c.phone, balance: Number(c.balance),
      portalStatus: c.portal_status, hasPortal: c.auth_user_id != null,
      ventas: ventas.get(c.id) ?? 0, cobranzas: cobranzas.get(c.id) ?? 0,
      createdAt: c.created_at, active: c.active,
    })).sort((a, b) => (b.ventas + b.cobranzas) - (a.ventas + a.cobranzas) || a.createdAt.localeCompare(b.createdAt)),
  })).sort((a, b) => b.accounts.length - a.accounts.length);

  return { groups };
}

/** Unifica cuentas duplicadas en la principal (solo admin). Mueve todo y elimina las duplicadas. */
export async function unificarClientes(targetId: string, sourceIds: string[]): Promise<ActionState & { unificadas?: number; conflictosPortal?: number }> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const sources = sourceIds.filter((s) => s && s !== targetId);
  if (!targetId || sources.length === 0) return { error: "Elegí la cuenta principal y al menos una duplicada." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("merge_customers", { p_target: targetId, p_sources: sources });
  if (error) return { error: error.message };
  const res = (data ?? {}) as { unificadas?: number; conflictos_portal?: number };
  revalidatePath("/clientes");
  revalidatePath("/clientes/duplicados");
  revalidatePath(`/clientes/${targetId}`);
  return { ok: true, unificadas: res.unificadas, conflictosPortal: res.conflictos_portal };
}

/** Ajuste manual del saldo de cuenta corriente (reservado a administración). */
export async function ajustarSaldoCliente(customerId: string, delta: number, reason: string): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isFinite(delta) || delta === 0) return { error: "Ingresá un monto distinto de cero" };
  const sb = await createClient();
  const { error } = await sb.rpc("adjust_customer_balance", { p_customer_id: customerId, p_delta: delta, p_reason: reason || null });
  if (error) return { error: error.message };
  revalidatePath(`/clientes/${customerId}`);
  return { ok: true };
}
