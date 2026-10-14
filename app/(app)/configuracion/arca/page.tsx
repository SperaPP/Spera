import { FileText } from "lucide-react";
import { requireView } from "@/lib/auth";
import { arcaConfig, arcaConfigured } from "@/lib/arca/config";
import { ArcaTestButton } from "@/components/arca-test-button";

export default async function ArcaConfigPage() {
  await requireView("configuracion");
  const cfg = arcaConfig();
  const ok = arcaConfigured();

  const row = (k: string, v: string, warn = false) => (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted">{k}</span>
      <span className={`font-medium tabular-nums ${warn ? "text-warn" : "text-ink"}`}>{v}</span>
    </div>
  );

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-5 flex items-center gap-2">
        <FileText className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-semibold text-ink">Facturación electrónica (ARCA)</h1>
      </div>

      <div className="rounded-xl border border-line bg-card p-5">
        <h2 className="mb-2 text-sm font-semibold text-ink">Estado de la conexión</h2>
        <div className="divide-y divide-line">
          {row("Entorno", cfg.env === "produccion" ? "Producción" : "Homologación (pruebas)", cfg.env !== "produccion")}
          {row("CUIT emisor", cfg.cuit || "— falta")}
          {row("Punto de venta", cfg.ptoVenta ? String(cfg.ptoVenta) : "— falta")}
          {row("Certificado", cfg.cert ? "cargado" : "— falta")}
          {row("Clave privada", cfg.key ? "cargada" : "— falta")}
        </div>

        <div className="mt-4 border-t border-line pt-4">
          {ok ? (
            <ArcaTestButton />
          ) : (
            <p className="text-sm text-muted">
              Faltan datos en el entorno. Cargá <code className="text-ink">ARCA_CUIT</code>,{" "}
              <code className="text-ink">ARCA_PTO_VENTA</code>, <code className="text-ink">ARCA_CERT</code> y{" "}
              <code className="text-ink">ARCA_KEY</code> (y opcional <code className="text-ink">ARCA_ENV</code>) en las
              variables de entorno, y volvé a entrar.
            </p>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-faint">
        Probar la conexión solo autentica con ARCA (obtiene un token). No emite ninguna factura.
      </p>
    </div>
  );
}
