"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { marcarArmadoImpreso } from "@/app/(app)/ventas/actions";

/** Abre la hoja de armado y marca el pedido como impreso. Después queda bloqueado
 *  (persistido en la venta) para evitar que se arme dos veces el mismo pedido. */
export function ImprimirArmadoButton({ saleId, printed }: { saleId: string; printed: boolean }) {
  const [done, setDone] = useState(printed);
  const [, start] = useTransition();

  if (done) {
    return (
      <span
        title="El pedido ya se imprimió. Bloqueado para no armarlo dos veces."
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
