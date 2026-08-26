"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Envía el mail de recuperación de contraseña (personal y portal). */
export async function solicitarReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Email inválido." };

  const h = await headers();
  const origin = h.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || "";
  const sb = await createClient();
  // No revelamos si el email existe o no: siempre respondemos ok.
  await sb.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/nueva-contrasena` });
  return { ok: true };
}

/** Setea la contraseña nueva (con la sesión de recuperación ya activa). */
export async function setNewPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 6) return { error: "La contraseña debe tener al menos 6 caracteres." };
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return { error: "El enlace expiró. Pedí uno nuevo." };
  const { error } = await sb.auth.updateUser({ password });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  redirect("/");
}

export async function login(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Ingresá email y contraseña." };
  }

  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Email o contraseña incorrectos." };
  }

  // Invalida el cache (si no, "/" sirve la versión cacheada sin sesión y rebota al login).
  revalidatePath("/", "layout");
  redirect("/");
}
