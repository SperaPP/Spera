"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, type ActionState } from "@/lib/auth";

export async function crearRol(name: string): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const clean = name.trim();
  if (!clean) return { error: "Ingresá un nombre" };
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  const { error } = await sb.from("roles").insert({ organization_id: orgId, name: clean });
  if (error) return { error: error.code === "23505" ? "Ya existe un rol con ese nombre" : error.message };
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function asignarSucursal(userId: string, storeId: string | null): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  if (storeId) {
    const { data: store } = await sb.from("stores").select("id").eq("id", storeId).maybeSingle();
    if (!store) return { error: "Sucursal inválida" };
  }

  // Editar el perfil de OTRO usuario requiere service-role (la policy solo permite el propio).
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ store_id: storeId }).eq("id", userId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function setPermiso(roleId: string, module: string, canView: boolean, canEdit: boolean): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  const { error } = await sb.from("role_permissions").upsert(
    { organization_id: orgId, role_id: roleId, module, can_view: canView, can_edit: canEdit },
    { onConflict: "role_id,module" }
  );
  if (error) return { error: error.message };
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function asignarRol(userId: string, roleId: string | null): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  if (roleId) {
    // El rol debe ser de esta organización (RLS acota el select a la org).
    const { data: role } = await sb.from("roles").select("id").eq("id", roleId).maybeSingle();
    if (!role) return { error: "Rol inválido" };
  }

  // Cambiar el rol de OTRO usuario requiere service-role (la policy de profiles solo
  // permite editar el propio). Acotamos por org por seguridad.
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ role_id: roleId }).eq("id", userId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/usuarios");
  return { ok: true };
}

/** Marca si un usuario puede abrir la caja titular del local. */
export async function setCajaTitular(userId: string, value: boolean): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;
  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };
  // Editar el perfil de OTRO usuario requiere service-role.
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ is_cash_titular: value }).eq("id", userId).eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/usuarios");
  return { ok: true };
}

/** Alta de usuario: crea la cuenta de acceso + su perfil (rol, sucursal, titular). */
export async function crearUsuario(input: {
  email: string; password: string; fullName: string;
  roleId: string | null; storeId: string | null; isCashTitular: boolean;
}): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Email inválido" };
  if (!input.password || input.password.length < 6) return { error: "La contraseña debe tener al menos 6 caracteres" };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  if (input.roleId) {
    const { data: role } = await sb.from("roles").select("id").eq("id", input.roleId).maybeSingle();
    if (!role) return { error: "Rol inválido" };
  }
  if (input.storeId) {
    const { data: store } = await sb.from("stores").select("id").eq("id", input.storeId).maybeSingle();
    if (!store) return { error: "Sucursal inválida" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email, password: input.password, email_confirm: true,
    user_metadata: { full_name: input.fullName.trim() || email },
  });
  if (error) return { error: error.message.includes("already") ? "Ya existe un usuario con ese email" : error.message };
  const uid = data.user?.id;
  if (!uid) return { error: "No se pudo crear el usuario" };

  // El trigger ya creó el profile en la org; le seteamos rol/sucursal/titular.
  const { error: pErr } = await admin.from("profiles").update({
    role_id: input.roleId, store_id: input.storeId,
    is_cash_titular: input.isCashTitular, full_name: input.fullName.trim() || email,
  }).eq("id", uid).eq("organization_id", orgId);
  if (pErr) return { error: pErr.message };

  revalidatePath("/usuarios");
  return { ok: true };
}

/** El admin le pone una contraseña nueva a un usuario de su organización. */
export async function resetearPassword(userId: string, newPassword: string): Promise<ActionState> {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!newPassword || newPassword.length < 6) return { error: "Mínimo 6 caracteres" };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  const { data: prof } = await sb.from("profiles").select("id").eq("id", userId).eq("organization_id", orgId).maybeSingle();
  if (!prof) return { error: "Usuario inválido" };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return { error: error.message };
  return { ok: true };
}
