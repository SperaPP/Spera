import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode } from "@/lib/tiendanube";

// Callback del OAuth de Tiendanube: recibe ?code, lo canjea por el access_token
// y lo guarda para la organización del usuario logueado. Solo el admin llega acá
// (el botón "Conectar" vive en una página gateada).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const back = (msg: string, ok = false) =>
    NextResponse.redirect(new URL(`/tiendanube?${ok ? "connected=1" : `error=${encodeURIComponent(msg)}`}`, url.origin));

  if (!code) return back("Tiendanube no devolvió el código de autorización");

  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return back("Iniciá sesión en Spera antes de conectar Tiendanube");
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
