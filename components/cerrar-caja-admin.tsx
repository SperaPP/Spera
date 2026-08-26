"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { cerrarCajaAdmin } from "@/app/(app)/caja/actions";

const input = "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

export function CerrarCajaAdmin({ sessionId, isTitular }: { sessionId: string; isTitular: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [declared, setDeclared] = useState("");
  const [kept, setKept] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    const d = Number(declared);
    const k = isTitular ? Number(kept) : 0;
    if (!isFinite(d) || d < 0) return toast.error("Ingresá el efectivo contado.");
    if (isTitular && (!isFinite(k) || k < 0)) return toast.error("Ingresá cuánto queda en caja chica.");
    start(async () => {
      const r = await cerrarCajaAdmin(sessionId, d, k, notes);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Caja cerrada por administración.");
      router.refresh();
    });
  }

  if (!open)
    return (
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-sm">
        <Lock className="h-4 w-4 shrink-0 text-warn" />
        <span className="text-ink">El cajero no está y hay que cerrar esta caja para reemplazarlo.</span>
        <button onClick={() => setOpen(true)} className="ml-auto rounded-lg border border-line-strong bg-card px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas">
          Cerrar caja (administración)
        </button>
      </div>
    );

  return (
    <div className="mb-5 rounded-xl border border-line bg-card p-5">
      <h2 className="mb-3 text-sm font-medium text-ink">Cierre administrativo</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Efectivo contado</label>
          <input type="number" min={0} value={declared} onChange={(e) => setDeclared(e.target.value)} className={input} placeholder="0" />
        </div>
        {isTitular && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Queda en caja chica</label>
            <input type="number" min={0} value={kept} onChange={(e) => setKept(e.target.value)} className={input} placeholder="0" />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted">Motivo (opcional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={input} placeholder="Ej: el cajero faltó" />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button onClick={() => setOpen(false)} className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
        <button onClick={submit} disabled={pending} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Cerrando…" : "Cerrar caja"}
        </button>
      </div>
      {isTitular && <p className="mt-2 text-xs text-muted">Si hay cajas de apoyo abiertas, cerralas primero.</p>}
    </div>
  );
}
