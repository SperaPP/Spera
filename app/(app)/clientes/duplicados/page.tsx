import Link from "next/link";
import { ArrowLeft, Users, ExternalLink, ShieldCheck } from "lucide-react";
import { formatMoney, formatDateTime } from "@/lib/format";
import { analizarDuplicados } from "@/app/(app)/clientes/actions";

export default async function DuplicadosPage() {
  const { error, groups } = await analizarDuplicados();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/clientes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a clientes
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Clientes duplicados</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Cuentas que comparten documento (un DNI y su CUIT cuentan como la misma persona). Revisá cada grupo antes de unificar.</p>

      {error ? (
        <div className="rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-sm text-ink">{error}</div>
      ) : !groups || groups.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-ok-bg text-ok"><ShieldCheck className="h-6 w-6" /></span>
          <p className="mt-3 font-medium text-ink">No hay cuentas duplicadas</p>
          <p className="mt-1 text-sm text-muted">No se encontraron clientes que compartan documento.</p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted"><span className="font-semibold text-ink">{groups.length}</span> persona(s) con cuentas duplicadas · <span className="font-semibold text-ink">{groups.reduce((a, g) => a + g.accounts.length, 0)}</span> cuentas en total.</p>
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.key} className="overflow-hidden rounded-xl border border-line bg-card">
                <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                  <Users className="h-4 w-4 text-muted" />
                  <span className="text-sm font-medium text-ink">{g.accounts[0]?.name}</span>
                  <span className="text-xs text-muted">· doc {g.key}</span>
                  <span className="ml-auto rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-medium text-warn">{g.accounts.length} cuentas</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                        <th className="px-4 py-2 font-medium">Cuenta</th>
                        <th className="px-4 py-2 font-medium">Documento</th>
                        <th className="px-4 py-2 text-right font-medium">Ventas</th>
                        <th className="px-4 py-2 text-right font-medium">Cobranzas</th>
                        <th className="px-4 py-2 text-right font-medium">Saldo</th>
                        <th className="px-4 py-2 font-medium">Estado</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.accounts.map((a) => (
                        <tr key={a.id} className="border-b border-line last:border-0 hover:bg-canvas">
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
                              {!a.active && <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted">Inactivo</span>}
                              {a.hasPortal && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">Portal</span>}
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
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
