"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BarChart3, ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { analizarTiendanube, type Analisis } from "@/app/(app)/tiendanube/actions";

function Stat({ label, value, tone = "ink" }: { label: string; value: string | number; tone?: "ink" | "ok" | "danger" | "warn" }) {
  const c = tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
      <div className={`text-lg font-semibold tabular-nums ${c}`}>{typeof value === "number" ? value.toLocaleString("es-AR") : value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

export function TiendanubeAnalisis() {
  const [pending, start] = useTransition();
  const [data, setData] = useState<Analisis | null>(null);

  function correr() {
    start(async () => {
      const r = await analizarTiendanube();
      if (!r.ok) { toast.error(r.error); return; }
      setData(r.data);
    });
  }

  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted" />
          <h2 className="text-sm font-medium text-ink">Análisis de la tienda (solo lectura)</h2>
        </div>
        <button onClick={correr} disabled={pending} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Analizando…" : data ? "Volver a correr" : "Correr análisis"}
        </button>
      </div>

      {!data ? (
        <p className="mt-3 text-sm text-muted">Cruza tu catálogo de Tiendanube con Spera por SKU. No modifica nada.</p>
      ) : (
        <div className="mt-5 space-y-6">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">En Tiendanube hoy</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Productos" value={data.tn.productos} />
              <Stat label="Variantes" value={data.tn.variantes} />
              <Stat label="Con SKU" value={data.tn.conSku} tone="ok" />
              <Stat label="Sin SKU" value={data.tn.sinSku} tone={data.tn.sinSku > 0 ? "warn" : "ink"} />
              <Stat label="Publicados" value={data.tn.publicados} />
              <Stat label="Ocultos" value={data.tn.ocultos} />
              <Stat label="SKU duplicados" value={data.tn.skuDuplicados} tone={data.tn.skuDuplicados > 0 ? "warn" : "ink"} />
            </div>
            {data.tn.sinSku > 0 && (
              <p className="mt-2 text-xs text-muted">Las variantes sin SKU no se pueden cruzar automáticamente — habría que matchearlas a mano o dejarlas afuera.</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Cruce por SKU</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Stat label="En ambos (se adoptan)" value={data.cruce.enAmbos} tone="ok" />
              <Stat label="Solo en Tiendanube (no se tocan)" value={data.cruce.soloTN} tone="warn" />
              <Stat label="Solo en Spera" value={data.cruce.soloSpera} />
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Lo que Spera publicaría (actual + con precio Público)</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Stat label="Publicables en total" value={data.publicables.total} />
              <Stat label="Ya existen en TN (adoptar)" value={data.publicables.yaEnTN} tone="ok" />
              <Stat label="Serían altas nuevas" value={data.publicables.nuevos} tone="warn" />
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Diferencias de precio en los que cruzan</h3>
            <Stat label="Variantes con precio distinto (TN vs Público de Spera)" value={data.precios.conDiferencia} tone={data.precios.conDiferencia > 0 ? "warn" : "ok"} />
            {data.precios.ejemplos.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                      <th className="px-3 py-2 font-medium">SKU</th>
                      <th className="px-3 py-2 text-right font-medium">En Tiendanube</th>
                      <th className="px-3 py-2"></th>
                      <th className="px-3 py-2 text-right font-medium">Público en Spera</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.precios.ejemplos.map((e) => (
                      <tr key={e.sku} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-ink">{e.sku}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{formatMoney(e.tn)}</td>
                        <td className="px-3 py-2 text-center text-faint"><ArrowRight className="mx-auto h-3.5 w-3.5" /></td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">{formatMoney(e.spera)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-line px-3 py-2 text-xs text-muted">Muestra de hasta 10. Cuando definamos el sync, decidís si Spera pisa el precio o lo respeta.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
