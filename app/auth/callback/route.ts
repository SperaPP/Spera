import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Canjea el código del mail (recuperación / confirmación) por una sesión. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(`${origin}/login?error=reset`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
