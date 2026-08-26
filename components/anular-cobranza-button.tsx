"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { anularCobranza } from "@/app/(app)/cobranzas/actions";

export function AnularCobranzaButton({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  if (confirm)
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">¿Anular? Repone el saldo y deshace la imputación.</span>
        <button
          onClick={() => start(async () => { const r = await anularCobranza(receiptId); if (r.error) toast.error(r.error); else { toast.success("Cobranza anulada."); router.refresh(); } })}
          disabled={pending}
          className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Anulando…" : "Sí, anular"}
        </button>
        <button onClick={() => setConfirm(false)} className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas">No</button>
      </div>
    );

  return (
    <button onClick={() => setConfirm(true)} className="inline-flex items-center gap-2 rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-bg">
      <Ban className="h-4 w-4" /> Anular cobranza
    </button>
  );
}
