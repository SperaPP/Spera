"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { reconciliarStockTN } from "@/app/(app)/tiendanube/actions";

export function ReconciliarStockTN() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<number | null>(null);

  function run() {
    if (!confirm("Esto encola TODAS las variantes linkeadas para empujar su stock actual a Tiendanube. El cron las procesa en los próximos minutos. ¿Seguir?")) return;
    start(async () => {
      const r = await reconciliarStockTN();
      if (!r.ok) { toast.error(r.error ?? "No se pudo reconciliar."); return; }
      setDone(r.encoladas ?? 0);
      toast.success(`${r.encoladas} variantes encoladas. Tiendanube se alinea en los próximos minutos.`);
    });
  }

  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <h3 className="text-sm font-medium text-ink">Reconciliar stock con Tiendanube</h3>
      <p className="mt-1 text-sm text-muted">
        Empuja el stock disponible actual de todas las variantes publicadas a Tiendanube. Útil si quedó algún arrastre.
        La sincronización normal es automática (con cada venta, en ~1-2 minutos); esto es solo para ponerlas todas al día de una.
      </p>
      <button onClick={run} disabled={pending} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-60">
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} /> {pending ? "Encolando…" : "Reconciliar ahora"}
      </button>
      {done !== null && <p className="mt-2 text-xs text-muted">{done} variantes encoladas. Tiendanube se va alineando en los próximos minutos.</p>}
    </div>
  );
}
