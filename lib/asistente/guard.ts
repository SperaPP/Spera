import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPermissions, type ActionState } from "@/lib/auth";
import { canView } from "@/lib/permissions";

/**
 * Guard ESTRICTO del Asistente IA: exige el permiso del módulo 'asistente'
 * tildado en la matriz de roles, SIN bypass de admin (a diferencia de
 * requireView). Decisión deliberada: "solo lo ve el dueño" — ni un
 * SuperAdministrador entra si su rol no tiene el tilde.
 * (Capa 3: asistente_query() revalida lo mismo dentro de SQL.)
 */
export async function requireAsistente(): Promise<ActionState | null> {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return { error: "No autenticado." };
  const perms = await getPermissions();
  if (!canView(perms, "asistente")) {
    return { error: "No tenés permiso para usar el asistente." };
  }
  return null;
}

/** Variante para páginas (server components): redirige en vez de devolver error. */
export async function requireAsistentePage(): Promise<void> {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) redirect("/login");
  const perms = await getPermissions();
  if (!canView(perms, "asistente")) redirect("/");
}
