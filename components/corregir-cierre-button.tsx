"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, X } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { corregirCierre } from "@/app/(app)/caja/actions";

const input = "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

export function CorregirCierreButton({ sessionId, isTitular, declared, kept, expenses, notes, expectedBase }: {
  sessionId: string; isTitular: boolean;
  declared: number; kept: number; expenses: number; notes: string; expectedBase: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(declared ? String(declared) : "");
  const [k, setK] = useState(kept ? String(kept) : "");
  const [e, setE] = useState(expenses ? String(expenses) : "");
  const [n, setN] = useState(notes ?? "");
  const [pending, start] = useTransition();

  const dN = Number(d) || 0, kN = Number(k) || 0, eN = Number(e) || 0;
  const newExpected = expectedBase - eN;
  const diff = isTitular && d !== "" ? dN - newExpected : null;
  const toSafe = Math.max(0, dN - kN);
  const keptTooBig = kN > dN;

  function save() {
    if (isTitular) {
      if (d === "") return toast.error("Ingresá el efectivo contado.");
      if (keptTooBig) return toast.error("La caja chica no puede superar el efectivo contado.");
    }
    start(async () => {
      const r = await corregirCierre(sessionId, dN, kN, eN, n);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Cierre corregido."); setOpen(false); router.refresh();
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas">
        <Pencil className="h-4 w-4" /> Corregir cierre
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-lg" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Corregir cierre de caja</h2>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>

            {isTitular ? (
              <>
                <p className="text-xs text-muted">Ajustá los valores del cierre. Se recalcula la diferencia y se reajustan la caja chica y la caja fuerte del local por el cambio.</p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Efectivo contado</label>
                    <input type="number" min={0} className={input} value={d} onChange={(ev) => setD(ev.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Queda en caja chica</label>
                    <input type="number" min={0} className={input} value={k} onChange={(ev) => setK(ev.target.value)} placeholder="0" />
                    {keptTooBig && <p className="mt-1 text-xs text-danger">No puede superar lo contado.</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-muted">Gastos en efectivo</label>
                    <input type="number" min={0} className={input} value={e} onChange={(ev) => setE(ev.target.value)} placeholder="0" />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-canvas px-3 py-2.5 text-sm">
                  <div><span className="text-muted">Diferencia: </span>
                    {diff == null ? "—" : <span className={`font-semibold tabular-nums ${diff === 0 ? "text-ok" : "text-danger"}`}>{diff > 0 ? "+" : ""}{formatMoney(diff)}</span>}
                  </div>
                  <div className="text-right"><span className="text-muted">A caja fuerte: </span><span className="font-semibold tabular-nums text-ink">{formatMoney(toSafe)}</span></div>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted">La caja de apoyo no tiene arqueo (rinde a la caja titular). Solo podés corregir la nota.</p>
            )}

            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-muted">Nota</label>
              <input className={input} value={n} onChange={(ev) => setN(ev.target.value)} placeholder="Motivo de la corrección" />
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
              <button onClick={save} disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
                {pending ? "Guardando…" : "Guardar corrección"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
