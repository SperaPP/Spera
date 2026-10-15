"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, X } from "lucide-react";
import { toast } from "sonner";
import { facturarVenta } from "@/app/(app)/ventas/[id]/facturar-actions";

export function FacturarButton({ saleId, env, compact = false }: { saleId: string; env: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const submitting = useRef(false); // candado sincrónico anti doble-click (no emite dos veces)

  function confirmar() {
    if (submitting.current) return;
    submitting.current = true;
    start(async () => {
      try {
        const r = await facturarVenta(saleId);
        if (r.ok) {
          toast.success(r.yaExistia ? "La venta ya tenía CAE." : `Facturada: CAE ${r.cae}`);
          setOpen(false);
          window.location.reload(); // la página se recarga; no reseteamos el candado
          return;
        }
        toast.error(r.error ?? "No se pudo facturar.");
      } catch {
        toast.error("Hubo un error al facturar. Reintentá en un momento.");
      }
      submitting.current = false; // solo ante error: permitir reintentar
    });
  }

  return (
    <>
      {compact ? (
        <button
          onClick={() => setOpen(true)}
          title="Facturar en ARCA"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-muted transition-colors hover:bg-canvas hover:text-accent"
        >
          <FileText className="h-4 w-4" />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas"
        >
          <FileText className="h-3.5 w-3.5" /> Facturar
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !pending && setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Facturar en ARCA</h2>
              <button onClick={() => !pending && setOpen(false)} className="rounded-md p-1 text-muted hover:text-ink disabled:opacity-40" disabled={pending}><X className="h-4 w-4" /></button>
            </div>
            <p className="text-sm text-muted">
              Se va a pedir el <strong>CAE</strong> a ARCA para esta venta
              {env !== "produccion" && <> en <strong>homologación (pruebas)</strong></>}. Una vez emitido, el comprobante
              queda registrado en ARCA y solo se revierte con una nota de crédito. ¿Confirmás?
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} disabled={pending} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-60">Cancelar</button>
              <button onClick={confirmar} disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60">
                {pending ? "Esperando factura…" : "Confirmar y facturar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
