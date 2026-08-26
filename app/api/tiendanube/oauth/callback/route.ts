import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode } from "@/lib/tiendanube";

// Callback del OAuth de Tiendanube: recibe ?code, lo canjea por el access_token
// y lo guarda para la organización. Solo admin, y valida el state (CSRF).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const back = (msg: string, ok = false) =>
    NextResponse.redirect(new URL(`/tiendanube?${ok ? "connected=1" : `error=${encodeURIComponent(msg)}`}`, url.origin));

  if (!code) return back("Tiendanube no devolvió el código de autorización");

  try {
    // Se lee y limpia el state SIEMPRE (aunque después algún chequeo corte).
    const jar = await cookies();
    const savedState = jar.get("tn_oauth_state")?.value;
    jar.delete("tn_oauth_state");

    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return back("Iniciá sesión en Spera antes de conectar Tiendanube");
    const { data: isAdmin } = await sb.rpc("is_admin");
    if (!isAdmin) return back("Solo un administrador puede conectar Tiendanube");

    // Validación CSRF: el state debe coincidir con el guardado al iniciar.
    if (!savedState || !state || savedState !== state) {
      return back("Falló la validación de seguridad. Volvé a intentar desde el botón Conectar.");
    }

    const { data: org } = await sb.rpc("current_org_id");
    if (!org) return back("Sin organización");

    const tok = await exchangeCode(code);

    const admin = createAdminClient();
    const { error } = await admin.from("tiendanube_credentials").upsert(
      {
        organization_id: org as string,
        store_id: String(tok.user_id),
        access_token: tok.access_token,
        scope: tok.scope ?? null,
        connected_at: new Date().toISOString(),
        connected_by: user.id,
      },
      { onConflict: "organization_id" }
    );
    if (error) return back(`No se pudo guardar la conexión: ${error.message}`);

    return back("", true);
  } catch (e) {
    return back(e instanceof Error ? e.message : "Error conectando con Tiendanube");
  }
}
