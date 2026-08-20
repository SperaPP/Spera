"use client";

import { toast } from "sonner";
import { FileText } from "lucide-react";

/** Placeholder de facturación electrónica. Se cablea cuando integremos ARCA (AFIP). */
export function FacturarButton() {
  return (
    <button
      onClick={() => toast.message("Facturación electrónica", { description: "Se habilita cuando integremos ARCA (AFIP)." })}
      title="Facturar (disponible al integrar ARCA)"
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-muted transition-colors hover:bg-canvas hover:text-accent"
    >
      <FileText className="h-4 w-4" />
    </button>
  );
}
