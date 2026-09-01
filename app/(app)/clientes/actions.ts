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
