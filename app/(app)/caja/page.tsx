import Link from "next/link";
import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CajaManager } from "@/components/caja-manager";

export type SessionSummary = {
  sales: number;
  sold: number;
  cash: number;
  expectedCash: number;
  byMethod: { name: string; amount: number }[];
};

export type CajaRow = {
  id: string;
  name: string;
  session: { id: string; openingAmount: number; openedAt: string } | null;
  summary: SessionSummary | null;
};

export default async function CajaPage() {
  const sb = await createClient();

  const [{ data: stores }, { data: openSessions }] = await Promise.all([
    sb.from("stores").select("id, name").eq("has_cash_register", true).eq("active", true).order("name"),
    sb.from("cash_sessions").select("id, store_id, opening_amount, opened_at").eq("status", "abierta"),
  ]);

  const openByStore = new Map((openSessions ?? []).map((s) => [s.store_id, s]));
  const summaries = new Map<string, SessionSummary>();

  for (const s of openSessions ?? []) {
    const { data: sales } = await sb
      .from("sales")
      .select("id, total")
      .eq("cash_session_id", s.id)
      .eq("status", "completada");
    const ids = (sales ?? []).map((x) => x.id);
    const sold = (sales ?? []).reduce((a, x) => a + Number(x.total), 0);

    let cash = 0;
    const byMethod = new Map<string, number>();
    if (ids.length) {
      const { data: pays } = await sb
        .from("sale_payments")
        .select("amount, payment_methods(name, affects_cash)")
        .in("sale_id", ids);
      for (const p of pays ?? []) {
        const raw = p.payment_methods as unknown;
        const m = (Array.isArray(raw) ? raw[0] : raw) as { name: string; affects_cash: boolean } | null;
        const amt = Number(p.amount);
        if (m) {
          byMethod.set(m.name, (byMethod.get(m.name) ?? 0) + amt);
          if (m.affects_cash) cash += amt;
        }
      }
    }

    // Cobranzas de cuenta corriente cobradas en este turno (entran al arqueo).
    const { data: receipts } = await sb.from("receipts").select("id").eq("cash_session_id", s.id);
    const rids = (receipts ?? []).map((r) => r.id);
    if (rids.length) {
      const { data: rpays } = await sb
        .from("receipt_payments")
        .select("amount, payment_methods(name, affects_cash)")
        .in("receipt_id", rids);
      for (const p of rpays ?? []) {
        const raw = p.payment_methods as unknown;
        const m = (Array.isArray(raw) ? raw[0] : raw) as { name: string; affects_cash: boolean } | null;
        const amt = Number(p.amount);
        if (m) {
          byMethod.set(m.name, (byMethod.get(m.name) ?? 0) + amt);
          if (m.affects_cash) cash += amt;
        }
      }
    }

    summaries.set(s.id, {
      sales: ids.length,
      sold,
      cash,
      expectedCash: Number(s.opening_amount) + cash,
      byMethod: [...byMethod.entries()].map(([name, amount]) => ({ name, amount })),
    });
  }

  const rows: CajaRow[] = (stores ?? []).map((st) => {
    const session = openByStore.get(st.id);
    return {
      id: st.id,
      name: st.name,
      session: session
        ? { id: session.id, openingAmount: Number(session.opening_amount), openedAt: session.opened_at }
        : null,
      summary: session ? summaries.get(session.id) ?? null : null,
    };
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Caja</h1>
          <p className="mt-1 text-sm text-muted">Apertura y cierre de turno por local.</p>
        </div>
        <Link href="/caja/cierres" className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas">
          <History className="h-4 w-4" /> Ver cierres
        </Link>
      </div>
      <CajaManager rows={rows} />
    </div>
  );
}
