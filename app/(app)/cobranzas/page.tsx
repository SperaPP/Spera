import Link from "next/link";
import { Plus, HandCoins } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDateTime } from "@/lib/format";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function CobranzasPage() {
  const sb = await createClient();
  const { data } = await sb
    .from("receipts")
    .select("id, number, total, created_at, status, customers(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = data ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Cobranzas</h1>
          <p className="mt-1 text-sm text-muted">Cobros a cuenta corriente de clientes.</p>
        </div>
        <Link
          href="/cobranzas/nueva"
          className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          Nueva cobranza
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <HandCoins className="h-5 w-5" />
          </span>
          <p className="mt-3 font-medium text-ink">Todavía no hay cobranzas</p>
          <p className="mt-1 text-sm text-muted">Registrá un cobro a cuenta corriente.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 text-right font-medium">Cobrado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3 tabular-nums">
                    <Link href={`/cobranzas/${r.id}`} className="text-accent transition-colors hover:underline">{r.number}</Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDateTime(r.created_at)}</td>
                  <td className="px-4 py-3 font-medium text-ink">
                    {relName(r.customers) ?? "—"}
                    {r.status === "anulada" && <span className="ml-2 rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-medium text-danger">Anulada</span>}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${r.status === "anulada" ? "text-faint line-through" : "text-ink"}`}>{formatMoney(Number(r.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
