"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Printer, RotateCcw } from "lucide-react";
import { marcarArmadoImpreso, reimprimirArmado } from "@/app/(app)/ventas/actions";

/** Abre la hoja de armado y marca el pedido como impreso. Después queda bloqueado
 *  (persistido en la venta) para evitar que se arme dos veces el mismo pedido.
 *  Administración puede reimprimir dejando registro. */
export function ImprimirArmadoButton({ saleId, printed, isAdmin }: { saleId: string; printed: boolean; isAdmin: boolean }) {
  const [done, setDone] = useState(printed);
  const [, start] = useTransition();

  if (done) {
    // Administración: puede reimprimir (queda registrado quién y cuándo).
    if (isAdmin) {
      return (
        <button
          title="Ya se imprimió. Reimprimir (admin) — queda registrado."
          onClick={() => {
            if (!confirm("El pedido ya figura impreso/armado. ¿Reimprimir de todas formas? Queda registrado quién y cuándo.")) return;
            window.open(`/ventas/${saleId}/armado`, "_blank");
            start(async () => {
              const r = await reimprimirArmado(saleId);
              if (r.error) toast.error(r.error); else toast.success("Reimpresión registrada.");
            });
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-warn/40 bg-warn-bg text-warn transition-colors hover:opacity-80"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      );
    }
    return (
      <span
        title="El pedido ya se imprimió. Bloqueado para no armarlo dos veces (pedile a administración si necesitás reimprimir)."
        className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-lg border border-line bg-canvas text-faint"
      >
        <Printer className="h-4 w-4" />
      </span>
    );
  }

  return (
    <button
      title="Imprimir pedido para el depósito (A4). Se puede imprimir una sola vez."
      onClick={() => {
        // Abrir la pestaña dentro del click (evita el bloqueo de pop-ups).
        window.open(`/ventas/${saleId}/armado`, "_blank");
        setDone(true);
        start(async () => {
          const r = await marcarArmadoImpreso(saleId);
          if (r.error) { toast.error(r.error); setDone(false); }
        });
      }}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-muted transition-colors hover:bg-canvas hover:text-accent"
    >
      <Printer className="h-4 w-4" />
    </button>
  );
}
