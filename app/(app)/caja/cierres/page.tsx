import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDateTime } from "@/lib/format";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}
function affectsCash(r: unknown): boolean {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { affects_cash: boolean } | null)?.affects_cash ?? false;
}

export default async function CierresPage() {
  const sb = await createClient();
  const { data: sessions } = await sb
    .from("cash_sessions")
    .select("id, opening_amount, declared_amount, cash_expenses, expected_cash, cash_difference, opened_at, closed_at, stores(name)")
    .in("status", ["cerrada", "entregada"])
    .order("closed_at", { ascending: false })
    .limit(30);

  const ids = (sessions ?? []).map((s) => s.id);

  // Ventas y cobros en efectivo por turno (una consulta por tabla).
  const soldBySession = new Map<string, number>();
  const cashBySession = new Map<string, number>();
  const cambioBySession = new Map<string, number>(); // crédito de cambios reusado

  if (ids.length) {
    const { data: sales } = await sb.from("sales").select("id, cash_session_id, total").in("cash_session_id", ids).eq("status", "completada");
    const saleSession = new Map<string, string>();
    for (const s of sales ?? []) {
      saleSession.set(s.id, s.cash_session_id);
      soldBySession.set(s.cash_session_id, (soldBySession.get(s.cash_session_id) ?? 0) + Number(s.total));
    }
    const saleIds = (sales ?? []).map((s) => s.id);
    if (saleIds.length) {
      const { data: sp } = await sb.from("sale_payments").select("sale_id, amount, payment_methods(affects_cash, kind)").in("sale_id", saleIds);
      for (const p of sp ?? []) {
        const sess = saleSession.get(p.sale_id);
        if (!sess) continue;
        const m = (Array.isArray(p.payment_methods) ? p.payment_methods[0] : p.payment_methods) as { affects_cash: boolean; kind: string } | null;
        if (m?.affects_cash) cashBySession.set(sess, (cashBySession.get(sess) ?? 0) + Number(p.amount));
        if (m?.kind === "cambio") cambioBySession.set(sess, (cambioBySession.get(sess) ?? 0) + Number(p.amount));
      }
    }

    const { data: receipts } = await sb.from("receipts").select("id, cash_session_id").in("cash_session_id", ids).neq("status", "anulada");
    const recSession = new Map<string, string>();
    for (const r of receipts ?? []) recSession.set(r.id, r.cash_session_id);
    const recIds = (receipts ?? []).map((r) => r.id);
    if (recIds.length) {
      const { data: rp } = await sb.from("receipt_payments").select("receipt_id, amount, payment_methods(affects_cash)").in("receipt_id", recIds);
      for (const p of rp ?? []) {
        if (affectsCash(p.payment_methods)) {
          const sess = recSession.get(p.receipt_id);
          if (sess) cashBySession.set(sess, (cashBySession.get(sess) ?? 0) + Number(p.amount));
        }
      }
    }
  }

  const rows = (sessions ?? []).map((s) => {
    const opening = Number(s.opening_amount);
    const cash = cashBySession.get(s.id) ?? 0;
    const expenses = Number(s.cash_expenses ?? 0);
    // Cerrada: usa lo guardado (contempla gastos y cajas de apoyo). Fallback en vivo.
    const expected = s.expected_cash != null ? Number(s.expected_cash) : opening + cash - expenses;
    const declared = s.declared_amount == null ? null : Number(s.declared_amount);
    return {
      id: s.id, store: relName(s.stores) ?? "—", closedAt: s.closed_at as string,
      opening, sold: (soldBySession.get(s.id) ?? 0) - (cambioBySession.get(s.id) ?? 0), expected, declared, expenses,
      diff: s.cash_difference != null ? Number(s.cash_difference) : (declared == null ? null : declared - expected),
    };
  });

  return (
    <div>
      <Link href="/caja" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a caja
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Cierres de caja</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Últimos turnos cerrados, con su arqueo.</p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-card px-4 py-12 text-center text-sm text-muted">Todavía no hay cierres.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Local</th>
                <th className="px-4 py-3 font-medium">Cerrado</th>
                <th className="px-4 py-3 text-right font-medium">Fondo</th>
                <th className="px-4 py-3 text-right font-medium">Vendido</th>
                <th className="px-4 py-3 text-right font-medium">Gastos efvo.</th>
                <th className="px-4 py-3 text-right font-medium">Efvo. esperado</th>
                <th className="px-4 py-3 text-right font-medium">Declarado</th>
                <th className="px-4 py-3 text-right font-medium">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3 font-medium text-ink">{r.store}</td>
                  <td className="px-4 py-3 text-muted">{formatDateTime(r.closedAt)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{formatMoney(r.opening)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{formatMoney(r.sold)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{r.expenses > 0 ? formatMoney(r.expenses) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{formatMoney(r.expected)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{r.declared == null ? "—" : formatMoney(r.declared)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.diff == null ? <span className="text-muted">—</span> :
                      <span className={r.diff === 0 ? "text-ok" : "text-danger"}>{r.diff > 0 ? "+" : ""}{formatMoney(r.diff)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
