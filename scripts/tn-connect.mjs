// Canjea el code del portal de TN por el access_token y lo guarda en la base.
// Uso: node --env-file=.env.local scripts/tn-connect.mjs <code>
// No imprime el token; solo confirma el guardado (store_id + scope).
import { createClient } from "@supabase/supabase-js";

const ORG = "a9695a41-4c61-4680-bfee-68a0c3af32a8"; // Bodysculpt
const code = process.argv[2];
if (!code) { console.error("Falta el code. Uso: node --env-file=.env.local scripts/tn-connect.mjs <code>"); process.exit(1); }

const res = await fetch("https://www.tiendanube.com/apps/authorize/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_id: process.env.TIENDANUBE_APP_ID,
    client_secret: process.env.TIENDANUBE_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
  }),
});
const text = await res.text();
if (!res.ok) { console.error("Token exchange falló:", res.status, text); process.exit(1); }
const tok = JSON.parse(text);

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { error } = await sb.from("tiendanube_credentials").upsert(
  {
    organization_id: ORG,
    store_id: String(tok.user_id),
    access_token: tok.access_token,
    scope: tok.scope ?? null,
    connected_at: new Date().toISOString(),
  },
  { onConflict: "organization_id" }
);
if (error) { console.error("No se pudo guardar:", error.message); process.exit(1); }

console.log("✓ Guardado. store_id:", tok.user_id);
console.log("scope:", tok.scope);
