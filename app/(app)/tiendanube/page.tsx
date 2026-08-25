import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTNCreds, fetchStoreName, tnConfigured, authorizeUrl } from "@/lib/tiendanube";
import { TiendanubeAnalisis } from "@/components/tiendanube-analisis";

export default async function TiendanubePage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { connected, error } = await searchParams;
  const sb = await createClient();
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  const { data: org } = await sb.rpc("current_org_id");
  const creds = org ? await getTNCreds(org as string) : null;
  const configured = tnConfigured();
  const appIdSet = !!process.env.TIENDANUBE_APP_ID;
  const secretSet = !!process.env.TIENDANUBE_CLIENT_SECRET;
  const storeName = creds ? await fetchStoreName(creds).catch(() => null) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Tiendanube</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Conexión con tu tienda online. Antes de publicar nada, corré el análisis: es solo lectura, no toca tu tienda.</p>

      {connected && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-ok/30 bg-ok-bg px-4 py-3 text-sm text-ink">
          <CheckCircle2 className="h-5 w-5 text-ok" /> Tiendanube conectado correctamente.
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-ink">
          <AlertTriangle className="h-5 w-5 text-danger" /> {error}
        </div>
      )}

      {!configured ? (
        <div className="rounded-xl border border-warn/30 bg-warn-bg p-5 text-sm text-ink">
          <p className="font-medium">Faltan las credenciales en el servidor.</p>
          <ul className="mt-2 space-y-0.5">
            <li><code>TIENDANUBE_APP_ID</code>: {appIdSet ? <span className="text-ok">✓ cargada</span> : <span className="text-danger">✗ no llega</span>}</li>
            <li><code>TIENDANUBE_CLIENT_SECRET</code>: {secretSet ? <span className="text-ok">✓ cargada</span> : <span className="text-danger">✗ no llega</span>}</li>
          </ul>
          <p className="mt-2 text-muted">Si alguna dice &quot;no llega&quot;: revisá que en Vercel esté escrita igual (sin espacios) y marcada para el entorno <strong>Production</strong>, y volvé a deployar.</p>
        </div>
      ) : creds ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-line bg-card p-5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-ok" />
              <span className="font-medium text-ink">Conectado{storeName ? ` a "${storeName}"` : ""}</span>
            </div>
            <p className="mt-1 text-sm text-muted">Store ID {creds.storeId}. El token quedó guardado; no vence.</p>
            <a href={authorizeUrl("spera")} className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent hover:underline">
              Reconectar / renovar permisos <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <TiendanubeAnalisis />
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-card p-5">
          <p className="text-sm text-ink">Todavía no conectaste tu tienda.</p>
          <p className="mt-1 text-sm text-muted">
            En el portal de Partners, la URL de redirección de la app debe ser:
            <br />
            <code className="text-xs">{`${process.env.NEXT_PUBLIC_SITE_URL ?? "https://spera-umber.vercel.app"}/api/tiendanube/oauth/callback`}</code>
          </p>
          <a href={authorizeUrl("spera")} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover">
            Conectar Tiendanube <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      )}
    </div>
  );
}
