"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SlidersHorizontal, X } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { ajustarSaldoCliente } from "@/app/(app)/clientes/actions";

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function AjusteSaldoButton({ customerId, balance }: { customerId: string; balance: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const n = Number(delta);
  const preview = delta.trim() !== "" && isFinite(n) && n !== 0 ? balance + n : null;

  function guardar() {
    if (!isFinite(n) || n === 0) return toast.error("Ingresá un monto distinto de cero.");
    if (!reason.trim()) return toast.error("Ingresá el motivo del ajuste.");
    start(async () => {
      const r = await ajustarSaldoCliente(customerId, n, reason.trim());
      if (r.error) { toast.error(r.error); return; }
      toast.success("Saldo ajustado."); setOpen(false); setDelta(""); setReason(""); router.refresh();
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas">
        <SlidersHorizontal className="h-4 w-4" /> Ajustar saldo
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Ajustar saldo de cuenta corriente</h2>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-muted">Corrige el saldo a mano (saldo inicial, condonación, corrección). Queda registrado en la cuenta corriente. Positivo = <span className="font-medium text-danger">suma deuda</span>; negativo = <span className="font-medium text-ok">resta deuda / a favor</span>.</p>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-muted">Monto (+ suma deuda / − resta)</label>
              <input type="number" className={input} value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="Ej. -5000 (condona) o 3000 (suma deuda)" />
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-muted">Motivo</label>
              <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Saldo inicial, condonación, corrección de error…" />
            </div>
            {preview != null && (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-canvas px-3 py-2 text-sm">
                <span className="text-muted">Saldo resultante</span>
                <span className={`font-semibold tabular-nums ${preview > 0 ? "text-danger" : preview < 0 ? "text-ok" : "text-ink"}`}>
                  {preview > 0 ? `Debe ${formatMoney(preview)}` : preview < 0 ? `A favor ${formatMoney(-preview)}` : formatMoney(0)}
                </span>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
              <button onClick={guardar} disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
                {pending ? "Aplicando…" : "Aplicar ajuste"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
