import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { authorizeUrl } from "@/lib/tiendanube";

// Inicia el OAuth de Tiendanube: solo admin. Genera un state aleatorio (CSRF),
// lo guarda en una cookie httpOnly y redirige a la autorización de TN.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) return NextResponse.redirect(new URL("/", url.origin));

  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("tn_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(state));
}
