"use server";

import { createClient } from "@/lib/supabase/server";
import { type ActionState } from "@/lib/auth";

/** El usuario logueado cambia su propia contraseña. */
export async function cambiarMiPassword(newPassword: string): Promise<ActionState> {
  if (!newPassword || newPassword.length < 6) {
    return { error: "La contraseña debe tener al menos 6 caracteres." };
  }
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return { error: "No autenticado." };

  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return { ok: true };
}
