"use client";

import { useState, useTransition } from "react";
import { FileText, X } from "lucide-react";
import { toast } from "sonner";
import { facturarVenta } from "@/app/(app)/ventas/[id]/facturar-actions";

export function FacturarButton({ saleId, env }: { saleId: string; env: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function confirmar() {
    start(async () => {
      const r = await facturarVenta(saleId);
      if (r.ok) {
        toast.success(r.yaExistia ? "La venta ya tenía CAE." : `Facturada: CAE ${r.cae}`);
        setOpen(false);
        // Refrescar para mostrar el CAE (revalidatePath del server).
        window.location.reload();
      } else {
        toast.error(r.error ?? "No se pudo facturar.");
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas"
      >
        <FileText className="h-3.5 w-3.5" /> Facturar
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !pending && setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Facturar en ARCA</h2>
              <button onClick={() => !pending && setOpen(false)} className="rounded-md p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-sm text-muted">
              Se va a pedir el <strong>CAE</strong> a ARCA para esta venta
              {env !== "produccion" && <> en <strong>homologación (pruebas)</strong></>}. Una vez emitido, el comprobante
              queda registrado en ARCA y solo se revierte con una nota de crédito. ¿Confirmás?
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-60">Cancelar</button>
              <button onClick={confirmar} disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60">
                {pending ? "Facturando…" : "Confirmar y facturar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
