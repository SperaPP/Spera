import Link from "next/link";
import { Wallet, ChevronRight, History } from "lucide-react";
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

const STATUS: Record<string, { label: string; cls: string }> = {
  abierta: { label: "Abierta", cls: "bg-warn-bg text-warn" },
  cerrada: { label: "Cerrada", cls: "bg-accent-soft text-accent" },
  entregada: { label: "Entregada", cls: "bg-ok-bg text-ok" },
};
const TABS = [
  { key: "cerrada", label: "Por entregar" },
  { key: "abierta", label: "Abiertas" },
  { key: "entregada", label: "Entregadas" },
  { key: "todas", label: "Todas" },
];

export default async function CajaPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const { estado } = await searchParams;
  const filter = estado && TABS.some((t) => t.key === estado) ? estado : "cerrada";
  const sb = await createClient();

  let req = sb
    .from("cash_sessions")
    .select("id, store_id, status, opening_amount, opened_at, closed_at, declared_amount, opened_by, stores(name)")
    .order("opened_at", { ascending: false }).limit(100);
  if (filter !== "todas") req = req.eq("status", filter);
  const { data: sessions } = await req;
  const sList = sessions ?? [];
  const ids = sList.map((s) => s.id);

  // Efectivo por período (fondo + ventas y cobranzas en efectivo), batcheado.
  const cashBySession = new Map<string, number>();
  if (ids.length) {
    const { data: sales } = await sb.from("sales").select("id, cash_session_id, total").in("cash_session_id", ids).eq("status", "completada");
    const saleSession = new Map<string, string>();
    for (const s of sales ?? []) saleSession.set(s.id, s.cash_session_id);
    const saleIds = (sales ?? []).map((s) => s.id);
    if (saleIds.length) {
      const { data: sp } = await sb.from("sale_payments").select("sale_id, amount, payment_methods(affects_cash)").in("sale_id", saleIds);
      for (const p of sp ?? []) {
        if (!affectsCash(p.payment_methods)) continue;
        const sess = saleSession.get(p.sale_id);
        if (sess) cashBySession.set(sess, (cashBySession.get(sess) ?? 0) + Number(p.amount));
      }
    }
    const { data: receipts } = await sb.from("receipts").select("id, cash_session_id").in("cash_session_id", ids);
    const recSession = new Map<string, string>();
    for (const r of receipts ?? []) recSession.set(r.id, r.cash_session_id);
    const recIds = (receipts ?? []).map((r) => r.id);
    if (recIds.length) {
      const { data: rp } = await sb.from("receipt_payments").select("receipt_id, amount, payment_methods(affects_cash)").in("receipt_id", recIds);
      for (const p of rp ?? []) {
        if (!affectsCash(p.payment_methods)) continue;
        const sess = recSession.get(p.receipt_id);
        if (sess) cashBySession.set(sess, (cashBySession.get(sess) ?? 0) + Number(p.amount));
      }
    }
  }

  // Nombres de cajeros.
  const openerIds = [...new Set(sList.map((s) => s.opened_by).filter(Boolean) as string[])];
  const nameById = new Map<string, string>();
  if (openerIds.length) {
    const { data: profs } = await sb.from("profiles").select("id, full_name, email").in("id", openerIds);
    for (const p of profs ?? []) nameById.set(p.id, p.full_name || p.email || "—");
  }

  // Pendiente de entregar por local (períodos cerrados: efectivo declarado).
  const { data: pend } = await sb.from("cash_sessions").select("declared_amount, stores(name)").eq("status", "cerrada");
  const pendingByStore = new Map<string, number>();
  for (const p of pend ?? []) {
    const store = relName(p.stores) ?? "—";
    pendingByStore.set(store, (pendingByStore.get(store) ?? 0) + Number(p.declared_amount ?? 0));
  }
  const totalPending = [...pendingByStore.values()].reduce((a, v) => a + v, 0);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Caja</h1>
          <p className="mt-1 text-sm text-muted">Períodos de caja por cajero. Revisá y entregá a administración.</p>
        </div>
        <Link href="/caja/cierres" className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">
          <History className="h-4 w-4" /> Historial
        </Link>
      </div>

      {pendingByStore.size > 0 && (
        <div className="mb-5 rounded-xl border border-accent/30 bg-accent-soft/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Pendiente de entregar</span>
            <span className="text-lg font-bold tabular-nums text-accent">{formatMoney(totalPending)}</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {[...pendingByStore.entries()].map(([store, amt]) => (
              <span key={store} className="text-muted">{store}: <span className="font-medium text-ink">{formatMoney(amt)}</span></span>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/caja?estado=${t.key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${filter === t.key ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-canvas"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {sList.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><Wallet className="h-5 w-5" /></span>
          <p className="mt-3 font-medium text-ink">No hay períodos en este estado.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Local</th>
                <th className="px-4 py-3 font-medium">Cajero</th>
                <th className="px-4 py-3 font-medium">Abierta</th>
                <th className="px-4 py-3 text-right font-medium">Efvo. esperado</th>
                <th className="px-4 py-3 text-right font-medium">Declarado</th>
                <th className="px-4 py-3 text-right font-medium">Dif.</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sList.map((s) => {
                const opening = Number(s.opening_amount);
                const expected = opening + (cashBySession.get(s.id) ?? 0);
                const declared = s.declared_amount == null ? null : Number(s.declared_amount);
                const diff = declared == null ? null : declared - expected;
                const st = STATUS[s.status] ?? STATUS.abierta;
                return (
                  <tr key={s.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3 font-medium text-ink">{relName(s.stores) ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{s.opened_by ? nameById.get(s.opened_by) ?? "—" : "—"}</td>
                    <td className="px-4 py-3 text-muted">{formatDateTime(s.opened_at)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{formatMoney(expected)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{declared == null ? "—" : formatMoney(declared)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{diff == null ? <span className="text-muted">—</span> : <span className={diff === 0 ? "text-ok" : "text-danger"}>{diff > 0 ? "+" : ""}{formatMoney(diff)}</span>}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span></td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/caja/${s.id}`} className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas">
                        {s.status === "cerrada" ? "Revisar / Entregar" : "Ver"} <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
