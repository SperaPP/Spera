import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatNumber, TZ, todayLocal } from "@/lib/format";

const PERIODS = [
  { key: "hoy", label: "Hoy" },
  { key: "7d", label: "Últimos 7 días" },
  { key: "mes", label: "Este mes" },
] as const;

function range(periodo: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  if (periodo === "hoy") {
    return { from: new Date(`${todayLocal()}T00:00:00-03:00`).toISOString(), to };
  }
  if (periodo === "mes") {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const [y, m] = parts.split("-");
    return { from: new Date(`${y}-${m}-01T00:00:00-03:00`).toISOString(), to };
  }
  return { from: new Date(now.getTime() - 7 * 86400000).toISOString(), to };
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export default async function ReportesPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const { periodo: raw } = await searchParams;
  const periodo = PERIODS.some((p) => p.key === raw) ? raw! : "mes";
  const { from, to } = range(periodo);

  const sb = await createClient();
  const [{ data: summary }, { data: byStore }, { data: byMethod }, { data: top }] = await Promise.all([
    sb.rpc("report_summary", { p_from: from, p_to: to }),
    sb.rpc("report_by_store", { p_from: from, p_to: to }),
    sb.rpc("report_by_method", { p_from: from, p_to: to }),
    sb.rpc("report_top_products", { p_from: from, p_to: to, p_limit: 10 }),
  ]);

  const s = (summary ?? { ventas: 0, cantidad: 0, unidades: 0 }) as { ventas: number; cantidad: number; unidades: number };
  const ticket = s.cantidad > 0 ? Number(s.ventas) / s.cantidad : 0;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Reportes</h1>
        <div className="flex gap-1 rounded-lg border border-line bg-card p-1">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/reportes?periodo=${p.key}`}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${periodo === p.key ? "bg-accent font-medium text-accent-fg" : "text-muted hover:text-ink"}`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Ventas" value={formatMoney(Number(s.ventas))} />
        <Tile label="Cantidad de ventas" value={formatNumber(s.cantidad)} />
        <Tile label="Ticket promedio" value={formatMoney(ticket)} />
        <Tile label="Unidades vendidas" value={formatNumber(s.unidades)} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ReportTable title="Ventas por local" cols={["Local", "Cantidad", "Ventas"]}
          rows={(byStore ?? []).map((r: { store: string; cantidad: number; ventas: number }) => [r.store, formatNumber(r.cantidad), formatMoney(Number(r.ventas))])} />
        <ReportTable title="Por medio de pago" cols={["Medio", "Total"]}
          rows={(byMethod ?? []).map((r: { metodo: string; total: number }) => [r.metodo, formatMoney(Number(r.total))])} />
      </div>

      <div className="mt-5">
        <ReportTable title="Top 10 productos" cols={["Producto", "Unidades", "Total"]}
          rows={(top ?? []).map((r: { producto: string; unidades: number; total: number }) => [r.producto, formatNumber(r.unidades), formatMoney(Number(r.total))])} />
      </div>
    </div>
  );
}

function ReportTable({ title, cols, rows }: { title: string; cols: string[]; rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">Sin datos en el período.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
              {cols.map((c, i) => <th key={c} className={`px-4 py-2.5 font-medium ${i > 0 ? "text-right" : ""}`}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-b border-line last:border-0">
                {r.map((cell, ci) => (
                  <td key={ci} className={`px-4 py-2.5 ${ci > 0 ? "text-right tabular-nums text-ink" : "font-medium text-ink"}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
