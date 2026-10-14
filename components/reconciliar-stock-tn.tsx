"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw, Link2 } from "lucide-react";
import { reconciliarStockTN, repararVinculosTN } from "@/app/(app)/tiendanube/actions";

export function ReconciliarStockTN() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<number | null>(null);
  const [fixPending, startFix] = useTransition();
  const [fixMsg, setFixMsg] = useState<string | null>(null);

  function run() {
    if (!confirm("Esto encola TODAS las variantes linkeadas para empujar su stock actual a Tiendanube. El cron las procesa en los próximos minutos. ¿Seguir?")) return;
    start(async () => {
      const r = await reconciliarStockTN();
      if (!r.ok) { toast.error(r.error ?? "No se pudo reconciliar."); return; }
      setDone(r.encoladas ?? 0);
      toast.success(`${r.encoladas} variantes encoladas. Tiendanube se alinea en los próximos minutos.`);
    });
  }

  function repair() {
    if (!confirm("Esto revisa TODOS los vínculos con Tiendanube y re-vincula por SKU los que apuntan a un producto/variante que cambió de id en TN. Puede tardar un momento. ¿Seguir?")) return;
    startFix(async () => {
      const r = await repararVinculosTN();
      if (!r.ok) { toast.error(r.error ?? "No se pudo reparar."); return; }
      setFixMsg(`${r.corregidos} vínculo(s) corregido(s), ${r.sinCambios} ya estaban OK, ${r.sinMatch} sin match por SKU.`);
      toast.success(`${r.corregidos} vínculo(s) reparado(s).`);
    });
  }

  return (
    <div className="space-y-4">
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

      <div className="rounded-xl border border-line bg-card p-5">
        <h3 className="text-sm font-medium text-ink">Reparar vínculos con Tiendanube</h3>
        <p className="mt-1 text-sm text-muted">
          Si un producto se borró y se volvió a crear en Tiendanube, su vínculo queda apuntando a un id viejo y el stock deja de actualizarse.
          Esto los re-vincula por <strong>SKU</strong> al producto/variante actual de TN. <span className="text-muted">(Igual, de ahora en más el sistema los repara solo cuando detecta el problema.)</span>
        </p>
        <button onClick={repair} disabled={fixPending} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-60">
          <Link2 className={`h-4 w-4 ${fixPending ? "animate-pulse" : ""}`} /> {fixPending ? "Reparando…" : "Reparar vínculos ahora"}
        </button>
        {fixMsg && <p className="mt-2 text-xs text-muted">{fixMsg}</p>}
      </div>
    </div>
  );
}
