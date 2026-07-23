import "server-only";
import { createClient } from "@/lib/supabase/server";
import { canEdit, canView, type Perms } from "@/lib/permissions";

/** Estado estándar de las server actions (useActionState). */
export type ActionState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

/** Permisos del usuario actual: { modulo: { view, edit } }. */
export async function getPermissions(): Promise<Perms> {
  const sb = await createClient();
  const { data } = await sb.rpc("get_my_permissions");
  return (data ?? {}) as Perms;
}

/**
 * Guard de server action (capa 2 de la seguridad en 3 capas).
 * Patrón de uso:
 *   const denied = await requireCan("productos", true);
 *   if (denied) return denied;
 * Devuelve un ActionState de error si no corresponde, o null si está habilitado.
 */
export async function requireCan(
  module: string,
  edit = false
): Promise<ActionState | null> {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return { error: "No autenticado." };

  const perms = await getPermissions();
  const ok = edit ? canEdit(perms, module) : canView(perms, module);
  if (!ok) return { error: "No tenés permiso para esta acción." };
  return null;
}

/** Guard para acciones reservadas al SuperAdministrador. */
export async function requireAdmin(): Promise<ActionState | null> {
  const sb = await createClient();
  const { data } = await sb.rpc("is_admin");
  if (data !== true) return { error: "Acción reservada a un administrador." };
  return null;
}
