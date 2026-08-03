"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, X, RotateCcw } from "lucide-react";
import { formatMoney, formatDateTime } from "@/lib/format";
import { aprobarDevolucion, rechazarDevolucion } from "@/app/(app)/devoluciones/actions";

export type DevolucionRow = {
  id: string;
  number: number;
  status: string;
  total: number;
  createdAt: string;
  customer: string;
  store: string;
  items: number;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-warn-bg text-warn" },
  aprobada: { label: "Aprobada", cls: "bg-ok-bg text-ok" },
  rechazada: { label: "Rechazada", cls: "bg-canvas text-muted" },
};

function RowActions({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex justify-end gap-2">
      <button
        disabled={pending}
        onClick={() => start(async () => { const r = await aprobarDevolucion(id); r.error ? toast.error(r.error) : toast.success("Devolución aprobada."); })}
        className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        <Check className="h-3.5 w-3.5" /> Aprobar
      </button>
      <button
        disabled={pending}
        onClick={() => start(async () => { const r = await rechazarDevolucion(id); r.error ? toast.error(r.error) : toast.success("Devolución rechazada."); })}
        className="flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-60"
      >
        <X className="h-3.5 w-3.5" /> Rechazar
      </button>
    </div>
  );
}

export function DevolucionesList({ rows }: { rows: DevolucionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <RotateCcw className="h-5 w-5" />
        </span>
        <p className="mt-3 font-medium text-ink">No hay devoluciones</p>
        <p className="mt-1 text-sm text-muted">Creá una nueva para empezar.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
            <th className="px-4 py-3 font-medium">#</th>
            <th className="px-4 py-3 font-medium">Fecha</th>
            <th className="px-4 py-3 font-medium">Cliente</th>
            <th className="px-4 py-3 font-medium">Local</th>
            <th className="px-4 py-3 text-right font-medium">Ítems</th>
            <th className="px-4 py-3 text-right font-medium">Total</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, cls: "bg-canvas text-muted" };
            return (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 tabular-nums text-muted">{r.number}</td>
                <td className="px-4 py-3 text-muted">{formatDateTime(r.createdAt)}</td>
                <td className="px-4 py-3 font-medium text-ink">{r.customer}</td>
                <td className="px-4 py-3 text-muted">{r.store}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink">{r.items}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink">{formatMoney(r.total)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                </td>
                <td className="px-4 py-3">{r.status === "pendiente" && <RowActions id={r.id} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
