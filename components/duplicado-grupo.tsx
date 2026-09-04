"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { Users, ExternalLink, GitMerge } from "lucide-react";
import { formatMoney, formatDateTime } from "@/lib/format";
import { unificarClientes, type DupGroup } from "@/app/(app)/clientes/actions";

export function DuplicadoGrupo({ group }: { group: DupGroup }) {
  const router = useRouter();
  const [target, setTarget] = useState(group.accounts[0]?.id ?? "");
  const [pending, start] = useTransition();

  const tgt = group.accounts.find((a) => a.id === target);
  const sources = group.accounts.filter((a) => a.id !== target);

  function unificar() {
    if (!tgt || sources.length === 0) return;
    if (!confirm(`Vas a unificar ${sources.length} cuenta(s) en "${tgt.name}".\n\nSe mueven ventas, cobranzas y saldos a esa cuenta y se ELIMINAN las duplicadas. Esta acción no se puede deshacer.\n\n¿Continuar?`)) return;
    start(async () => {
      const r = await unificarClientes(target, sources.map((s) => s.id));
      if (r.error) { toast.error(r.error); return; }
      toast.success(`Unificadas ${r.unificadas} cuenta(s) en "${tgt.name}".${r.conflictosPortal ? ` ${r.conflictosPortal} login(s) de portal quedaron sin uso (quedó el de la principal).` : ""}`);
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Users className="h-4 w-4 text-muted" />
        <span className="text-sm font-medium text-ink">{group.accounts[0]?.name}</span>
        <span className="text-xs text-muted">· doc {group.key}</span>
        <span className="ml-auto rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-medium text-warn">{group.accounts.length} cuentas</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
              <th className="px-4 py-2 font-medium">Principal</th>
              <th className="px-4 py-2 font-medium">Cuenta</th>
              <th className="px-4 py-2 font-medium">Documento</th>
              <th className="px-4 py-2 text-right font-medium">Ventas</th>
              <th className="px-4 py-2 text-right font-medium">Cobranzas</th>
              <th className="px-4 py-2 text-right font-medium">Saldo</th>
              <th className="px-4 py-2 font-medium"></th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {group.accounts.map((a) => (
              <tr key={a.id} className={`border-b border-line last:border-0 ${a.id === target ? "bg-accent-soft/40" : "hover:bg-canvas"}`}>
                <td className="px-4 py-2.5">
                  <input type="radio" name={`target-${group.key}`} checked={a.id === target} onChange={() => setTarget(a.id)} className="h-4 w-4 accent-[var(--accent,#4338ca)]" />
                </td>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-ink">{a.name}</div>
                  <div className="text-xs text-muted">{a.email ?? a.phone ?? "—"} · desde {formatDateTime(a.createdAt)}</div>
                </td>
                <td className="px-4 py-2.5 text-muted">{a.docType} {a.docNumber}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{a.ventas}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{a.cobranzas}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${a.balance > 0 ? "text-danger" : a.balance < 0 ? "text-ok" : "text-muted"}`}>{a.balance > 0 ? `Debe ${formatMoney(a.balance)}` : a.balance < 0 ? `A favor ${formatMoney(-a.balance)}` : formatMoney(0)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {a.id === target ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">Se conserva</span> : <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-medium text-danger">Se elimina</span>}
                    {!a.active && <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted">Inactivo</span>}
                    {a.hasPortal && <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted">Portal</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={`/clientes/${a.id}`} className="inline-flex items-center gap-1 text-accent hover:underline">Ver <ExternalLink className="h-3.5 w-3.5" /></Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
        <span className="text-xs text-muted">Elegí la cuenta que se conserva; el resto se funde en ella y se elimina.</span>
        <button onClick={unificar} disabled={pending || sources.length === 0} className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
          <GitMerge className="h-4 w-4" /> {pending ? "Unificando…" : `Unificar ${sources.length} en la principal`}
        </button>
      </div>
    </div>
  );
}
