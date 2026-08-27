import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Canjea el código del mail (recuperación / confirmación) por una sesión. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Solo se aceptan paths internos (evita open redirect: `next=//evil.com` o
  // `next=https://evil.com` mandarían a otro sitio). Debe empezar con "/" y no "//".
  const raw = searchParams.get("next") ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(`${origin}/login?error=reset`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
