"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { aceptarReposicion } from "@/app/(app)/reposiciones/actions";

export type RepoItem = {
  variantId: string;
  name: string;
  label: string | null;
  sku: string | null;
  pending: number;
  avail: number;
  max: number;
};

export function ReposicionForm({ storeId, items }: { storeId: string; items: RepoItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Por defecto se repone el máximo posible (mín entre pendiente y disponible en Central).
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const q: Record<string, string> = {};
    for (const it of items) q[it.variantId] = String(it.max);
    return q;
  });

  const total = items.reduce((a, it) => a + (Number(qty[it.variantId]) || 0), 0);

  function setVal(it: RepoItem, raw: string) {
    let n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > it.max) n = it.max; // tope: no reponer más de lo disponible ni de lo pendiente
    setQty((q) => ({ ...q, [it.variantId]: String(n) }));
  }

  function aceptar() {
    const chosen = items.map((it) => ({ variantId: it.variantId, quantity: Number(qty[it.variantId]) || 0 }));
    if (chosen.every((c) => c.quantity <= 0)) {
      if (!confirm("No estás reponiendo ninguna prenda. Al aceptar se descarta todo el pendiente. ¿Continuar?")) return;
    }
    start(async () => {
      const r = await aceptarReposicion(storeId, chosen);
      if (r.error) { toast.error(r.error); return; }
      if (r.transferId) {
        toast.success("Reposición aceptada. Se creó la transferencia.");
        router.push(`/transferencias/${r.transferId}`);
      } else {
        toast.success("Pendiente descartado.");
        router.push("/reposiciones");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
              <th className="px-4 py-3 font-medium">Prenda</th>
              <th className="px-4 py-3 text-right font-medium">Vendidas</th>
              <th className="px-4 py-3 text-right font-medium">Disp. Central</th>
              <th className="px-4 py-3 text-right font-medium">Reponer</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.variantId} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-ink">{it.name}{it.label && <span className="ml-2 text-xs text-muted">{it.label}</span>}</div>
                  {it.sku && <div className="font-mono text-xs text-muted">{it.sku}</div>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted">{it.pending}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${it.avail < it.pending ? "text-warn" : "text-muted"}`}>{it.avail}</td>
                <td className="px-4 py-2.5 text-right">
                  <input
                    type="number" min={0} max={it.max}
                    value={qty[it.variantId] ?? "0"}
                    onChange={(e) => setVal(it, e.target.value)}
                    disabled={it.max === 0}
                    className="w-20 rounded-lg border border-line-strong bg-card px-2 py-1.5 text-center text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted">Total a reponer: <span className="font-semibold text-ink">{total}</span> unidades</span>
        <button onClick={aceptar} disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Creando…" : "Aceptar y crear transferencia"}
        </button>
      </div>
    </div>
  );
}
