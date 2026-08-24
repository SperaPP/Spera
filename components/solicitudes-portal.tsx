"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserCheck, Check, X, Clock } from "lucide-react";
import { aprobarPortalCliente, rechazarPortalCliente } from "@/app/(app)/clientes/actions";

type Pending = { id: string; name: string; doc: string | null; email: string | null; phone: string | null };
type Tipo = { id: string; name: string };

const select = "rounded-lg border border-line-strong bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

export function SolicitudesPortal({ pending, tipos }: { pending: Pending[]; tipos: Tipo[] }) {
  const router = useRouter();
  const [tipoBy, setTipoBy] = useState<Record<string, string>>(() => Object.fromEntries(pending.map((p) => [p.id, tipos[0]?.id ?? ""])));
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  if (pending.length === 0) return null;

  function aprobar(id: string) {
    setBusy(id);
    start(async () => {
      const r = await aprobarPortalCliente(id, tipoBy[id] || null);
      setBusy(null);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Cliente aprobado."); router.refresh();
    });
  }
  function rechazar(id: string) {
    if (!confirm("¿Rechazar esta solicitud? El cliente no podrá comprar.")) return;
    setBusy(id);
    start(async () => {
      const r = await rechazarPortalCliente(id);
      setBusy(null);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Solicitud rechazada."); router.refresh();
    });
  }

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-warn/40 bg-warn-bg/30">
      <div className="flex items-center gap-2 border-b border-warn/30 px-4 py-3 text-sm font-medium text-ink">
        <Clock className="h-4 w-4 text-warn" /> Solicitudes del portal
        <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn">{pending.length}</span>
      </div>
      <div className="divide-y divide-line">
        {pending.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <UserCheck className="h-4 w-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink">{p.name}</div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                {p.doc && <span>{p.doc}</span>}
                {p.email && <span>{p.email}</span>}
                {p.phone && <span>{p.phone}</span>}
              </div>
            </div>
            <select value={tipoBy[p.id] ?? ""} onChange={(e) => setTipoBy((t) => ({ ...t, [p.id]: e.target.value }))} className={select} title="Lista de precios del cliente">
              {tipos.length === 0 && <option value="">Sin tipos</option>}
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={() => aprobar(p.id)} disabled={busy === p.id} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
              <Check className="h-4 w-4" /> Aprobar
            </button>
            <button onClick={() => rechazar(p.id)} disabled={busy === p.id} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger-bg disabled:opacity-60">
              <X className="h-4 w-4" /> Rechazar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
