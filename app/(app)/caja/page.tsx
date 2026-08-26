import Link from "next/link";
import { Wallet, ChevronRight, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPermissions, getStoreScope } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { formatMoney, formatDateTime } from "@/lib/format";
import { CajaAdmin } from "@/components/caja-admin";

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
  cerrada: { label: "Cerrada", cls: "bg-ok-bg text-ok" },
  entregada: { label: "Entregada", cls: "bg-canvas text-muted" },
};
const TABS = [
  { key: "cerrada", label: "Cerradas" },
  { key: "abierta", label: "Abiertas" },
  { key: "todas", label: "Todas" },
];

export default async function CajaPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const { estado } = await searchParams;
  const filter = estado && TABS.some((t) => t.key === estado) ? estado : "cerrada";
  const sb = await createClient();
  const canAdmin = canEdit(await getPermissions(), "caja_admin");
  const { storeId: scopeStore } = await getStoreScope();

  const storesReq = sb.from("stores").select("id, name").eq("has_cash_register", true).eq("active", true).order("name");
  const delivReq = sb.from("central_deliveries").select("id, amount, notes, delivered_at, delivered_by, stores(name)").order("delivered_at", { ascending: false }).limit(15);
  const [{ data: stores }, { data: safes }, { data: petty }, { data: profiles }, { data: deliveries }] = await Promise.all([
    scopeStore ? storesReq.eq("id", scopeStore) : storesReq,
    sb.from("store_safe").select("store_id, balance"),
    sb.from("store_petty").select("store_id, balance"),
    sb.from("profiles").select("id, full_name, email, store_id"),
    scopeStore ? delivReq.eq("store_id", scopeStore) : delivReq,
  ]);

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email || "—"]));
  const safeByStore = new Map((safes ?? []).map((s) => [s.store_id, Number(s.balance)]));
  const pettyByStore = new Map((petty ?? []).map((p) => [p.store_id, Number(p.balance)]));
  const storeRows = (stores ?? []).map((s) => ({
    id: s.id, name: s.name, safe: safeByStore.get(s.id) ?? 0, petty: pettyByStore.get(s.id) ?? 0,
  }));

  // ── Períodos ────────────────────────────────────────────────
  let req = sb.from("cash_sessions")
    .select("id, store_id, status, role, opening_amount, opened_at, closed_at, declared_amount, kept_amount, to_safe_amount, opened_by, stores(name)")
    .order("opened_at", { ascending: false }).limit(80);
  if (scopeStore) req = req.eq("store_id", scopeStore);
  if (filter !== "todas") req = req.eq("status", filter);
  const { data: sessions } = await req;
  const sList = sessions ?? [];
  const ids = sList.map((s) => s.id);

  const cashBySession = new Map<string, number>();
  if (ids.length) {
    const { data: sales } = await sb.from("sales").select("id, cash_session_id, total").in("cash_session_id", ids).eq("status", "completada");
    const saleSession = new Map<string, string>();
    for (const x of sales ?? []) saleSession.set(x.id, x.cash_session_id);
    const saleIds = (sales ?? []).map((x) => x.id);
    if (saleIds.length) {
      const { data: sp } = await sb.from("sale_payments").select("sale_id, amount, payment_methods(affects_cash)").in("sale_id", saleIds);
      for (const p of sp ?? []) { if (!affectsCash(p.payment_methods)) continue; const ss = saleSession.get(p.sale_id); if (ss) cashBySession.set(ss, (cashBySession.get(ss) ?? 0) + Number(p.amount)); }
    }
    const { data: recs } = await sb.from("receipts").select("id, cash_session_id").in("cash_session_id", ids).neq("status", "anulada");
    const recSession = new Map<string, string>();
    for (const r of recs ?? []) recSession.set(r.id, r.cash_session_id);
    const recIds = (recs ?? []).map((r) => r.id);
    if (recIds.length) {
      const { data: rp } = await sb.from("receipt_payments").select("receipt_id, amount, payment_methods(affects_cash)").in("receipt_id", recIds);
      for (const p of rp ?? []) { if (!affectsCash(p.payment_methods)) continue; const ss = recSession.get(p.receipt_id); if (ss) cashBySession.set(ss, (cashBySession.get(ss) ?? 0) + Number(p.amount)); }
    }
  }

  // El efectivo de las cajas de apoyo se rinde a la titular: se consolida en su arqueo.
  const titularsByStore = new Map<string, { id: string; opened_at: string }[]>();
  for (const s of sList) if (s.role !== "apoyo") {
    const arr = titularsByStore.get(s.store_id) ?? [];
    arr.push({ id: s.id, opened_at: s.opened_at });
    titularsByStore.set(s.store_id, arr);
  }
  for (const arr of titularsByStore.values()) arr.sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1)); // más nueva primero
  const apoyoCashByTitular = new Map<string, number>();
  for (const s of sList) if (s.role === "apoyo") {
    const owner = (titularsByStore.get(s.store_id) ?? []).find((t) => t.opened_at <= s.opened_at);
    if (owner) apoyoCashByTitular.set(owner.id, (apoyoCashByTitular.get(owner.id) ?? 0) + (cashBySession.get(s.id) ?? 0));
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Caja</h1>
          <p className="mt-1 text-sm text-muted">Caja chica y caja fuerte por local, y entregas a Casa Central.</p>
        </div>
        <Link href="/caja/cierres" className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">
          <History className="h-4 w-4" /> Historial de cierres
        </Link>
      </div>

      {storeRows.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-faint">Cajas por local</h2>
          <div className="mb-8"><CajaAdmin stores={storeRows} canAdmin={canAdmin} /></div>
        </>
      )}

      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-faint">Períodos por cajero</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/caja?estado=${t.key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${filter === t.key ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-canvas"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {sList.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-card py-14 text-center">
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
                <th className="px-4 py-3 text-right font-medium">A fuerte</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sList.map((s) => {
                const own = Number(s.opening_amount) + (cashBySession.get(s.id) ?? 0);
                const expected = s.role === "apoyo" ? own : own + (apoyoCashByTitular.get(s.id) ?? 0);
                const declared = s.declared_amount == null ? null : Number(s.declared_amount);
                const diff = declared == null ? null : Math.round((declared - expected) * 100) / 100;
                const st = STATUS[s.status] ?? STATUS.abierta;
                return (
                  <tr key={s.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3 font-medium text-ink">{relName(s.stores) ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">
                      <span className="flex items-center gap-1.5">
                        {s.opened_by ? nameById.get(s.opened_by) ?? "—" : "—"}
                        {s.role === "apoyo" && <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium uppercase text-faint">apoyo</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDateTime(s.opened_at)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{formatMoney(expected)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">
                      {declared == null ? "—" : formatMoney(declared)}
                      {diff != null && Math.abs(diff) > 0.01 && (
                        <div className={`text-[11px] font-medium ${diff < 0 ? "text-danger" : "text-warn"}`}>
                          {diff > 0 ? "sobra " : "falta "}{formatMoney(Math.abs(diff))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{s.to_safe_amount == null ? "—" : formatMoney(Number(s.to_safe_amount))}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span></td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/caja/${s.id}`} className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas">Ver <ChevronRight className="h-3.5 w-3.5" /></Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(deliveries ?? []).length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-wide text-faint">Entregas a Casa Central</h2>
          <div className="divide-y divide-line rounded-xl border border-line bg-card">
            {(deliveries ?? []).map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="font-medium text-ink">{relName(d.stores) ?? "—"}</span>
                <span className="font-semibold tabular-nums text-accent">{formatMoney(Number(d.amount))}</span>
                <span className="text-muted">{formatDateTime(d.delivered_at)}</span>
                {d.delivered_by && <span className="text-xs text-muted">{nameById.get(d.delivered_by) ?? ""}</span>}
                {d.notes && <span className="text-xs text-muted">· {d.notes}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
