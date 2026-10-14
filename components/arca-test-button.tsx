"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle, Plug } from "lucide-react";
import { probarConexionArca } from "@/app/(app)/configuracion/arca/actions";

type Resultado = Awaited<ReturnType<typeof probarConexionArca>>;

export function ArcaTestButton() {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<Resultado | null>(null);

  function probar() {
    start(async () => setRes(await probarConexionArca()));
  }

  return (
    <div className="space-y-3">
      <button
        onClick={probar}
        disabled={pending}
        className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        <Plug className="h-4 w-4" /> {pending ? "Probando…" : "Probar conexión"}
      </button>

      {res && (
        <div className={`rounded-lg border p-3 text-sm ${res.ok ? "border-ok bg-ok-bg text-ink" : "border-danger bg-danger-bg text-ink"}`}>
          <div className="flex items-center gap-2 font-medium">
            {res.ok ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <XCircle className="h-4 w-4 text-danger" />}
            {res.ok ? "Autenticación con ARCA correcta" : "No se pudo autenticar con ARCA"}
          </div>
          {res.ok ? (
            <p className="mt-1 text-muted">
              Entorno <strong>{res.env}</strong>. Token válido hasta{" "}
              <strong>{res.expira ? new Date(res.expira).toLocaleString("es-AR") : "—"}</strong>.
            </p>
          ) : (
            <p className="mt-1 text-muted">{res.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
