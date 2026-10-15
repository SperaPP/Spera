"use client";

import { useState, useTransition } from "react";
import { FileMinus, X } from "lucide-react";
import { toast } from "sonner";
import { emitirNotaCredito } from "@/app/(app)/ventas/[id]/facturar-actions";

export function NotaCreditoButton({ saleId, env }: { saleId: string; env: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function confirmar() {
    start(async () => {
      const r = await emitirNotaCredito(saleId);
      if (r.ok) {
        toast.success(r.yaExistia ? "La factura ya tenía nota de crédito." : `Nota de crédito emitida: CAE ${r.cae}`);
        setOpen(false);
        window.location.reload();
      } else {
        toast.error(r.error ?? "No se pudo emitir la nota de crédito.");
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-bg"
      >
        <FileMinus className="h-3.5 w-3.5" /> Emitir nota de crédito
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !pending && setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Nota de crédito</h2>
              <button onClick={() => !pending && setOpen(false)} className="rounded-md p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-sm text-muted">
              Se va a emitir una <strong>nota de crédito por el total</strong> que anula la factura de esta venta en ARCA
              {env !== "produccion" && <> (homologación)</>}. Queda registrada en ARCA con su propio CAE y no se puede deshacer.
              Es solo el comprobante fiscal: no toca el stock ni la cuenta corriente. ¿Confirmás?
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-60">Cancelar</button>
              <button onClick={confirmar} disabled={pending} className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
                {pending ? "Emitiendo…" : "Emitir nota de crédito"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
