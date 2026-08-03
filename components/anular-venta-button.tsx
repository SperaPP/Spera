"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Ban } from "lucide-react";

import { anularVenta } from "@/app/(app)/ventas/actions";

export function AnularVentaButton({ saleId }: { saleId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">¿Anular? Repone stock y revierte deuda.</span>
        <button
          onClick={() => start(async () => { const r = await anularVenta(saleId); if (r.error) toast.error(r.error); else toast.success("Venta anulada."); })}
          disabled={pending}
          className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Anulando…" : "Sí, anular"}
        </button>
        <button onClick={() => setConfirming(false)} disabled={pending} className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas">No</button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger-bg">
      <Ban className="h-4 w-4" /> Anular venta
    </button>
  );
}
