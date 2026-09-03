import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getStoreScope, getPermissions } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { formatMoney, formatDateTime } from "@/lib/format";
import { CerrarCajaAdmin } from "@/components/cerrar-caja-admin";

function rel<T>(r: unknown): T | null { return (Array.isArray(r) ? r[0] : r) as T | null; }

const STATUS: Record<string, { label: string; cls: string }> = {
  abierta: { label: "Abierta", cls: "bg-warn-bg text-warn" },
  cerrada: { label: "Cerrada", cls: "bg-ok-bg text-ok" },
  entregada: { label: "Entregada", cls: "bg-canvas text-muted" },
};

export default async function PeriodoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const { data: s } = await sb
    .from("cash_sessions")
    .select("id, status, role, store_id, opening_amount, opened_at, closed_at, declared_amount, kept_amount, to_safe_amount, cash_expenses, expected_cash, cash_difference, notes, opened_by, stores(name)")
    .eq("id", id).single();
  if (!s) notFound();
  const { storeId: scopeStore } = await getStoreScope();
  if (scopeStore && s.store_id !== scopeStore) notFound();
  const canAdmin = canEdit(await getPermissions(), "caja_admin");

  const [{ data: sales }, { data: receipts }, { data: opener }] = await Promise.all([
    sb.from("sales").select("id, number, total, created_at, channel, customers(name), sale_payments(amount, payment_methods(name, affects_cash, kind))").eq("cash_session_id", id).eq("status", "completada").order("created_at"),
    sb.from("receipts").select("id, number, total, created_at, customers(name), receipt_payments(amount, payment_methods(name, affects_cash))").eq("cash_session_id", id).neq("status", "anulada").order("created_at"),
    s.opened_by ? sb.from("profiles").select("full_name, email").eq("id", s.opened_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  // Desglose por medio de pago + efectivo + neto (excluye "Cambio").
  const byMethod = new Map<string, number>();
  let cash = 0, cambio = 0;
  const addPay = (name: string, amount: number, affects: boolean, kind?: string) => {
    byMethod.set(name, (byMethod.get(name) ?? 0) + amount);
    if (affects) cash += amount;
    if (kind === "cambio") cambio += amount;
  };
  for (const sale of sales ?? []) for (const p of (sale.sale_payments ?? []) as { amount: number; payment_methods: unknown }[]) {
    const m = rel<{ name: string; affects_cash: boolean; kind: string }>(p.payment_methods);
    if (m) addPay(m.name, Number(p.amount), m.affects_cash, m.kind);
  }
  for (const r of receipts ?? []) for (const p of (r.receipt_payments ?? []) as { amount: number; payment_methods: unknown }[]) {
    const m = rel<{ name: string; affects_cash: boolean }>(p.payment_methods);
    if (m) addPay(m.name, Number(p.amount), m.affects_cash);
  }
  // La titular recibe el efectivo de sus cajas de apoyo: se consolida en su arqueo.
  let apoyoCash = 0;
  if (s.role !== "apoyo") {
    let aq = sb.from("cash_sessions").select("id").eq("store_id", s.store_id).eq("role", "apoyo").gte("opened_at", s.opened_at);
    if (s.closed_at) aq = aq.lte("opened_at", s.closed_at);
    const { data: apoyos } = await aq;
    const aids = (apoyos ?? []).map((a) => a.id);
    if (aids.length) {
      const { data: asales } = await sb.from("sales").select("id").in("cash_session_id", aids).eq("status", "completada");
      const asaleIds = (asales ?? []).map((x) => x.id);
      if (asaleIds.length) {
        const { data: asp } = await sb.from("sale_payments").select("amount, payment_methods(affects_cash)").in("sale_id", asaleIds);
        for (const p of asp ?? []) if (rel<{ affects_cash: boolean }>(p.payment_methods)?.affects_cash) apoyoCash += Number(p.amount);
      }
      const { data: arecs } = await sb.from("receipts").select("id").in("cash_session_id", aids).neq("status", "anulada");
      const arecIds = (arecs ?? []).map((r) => r.id);
      if (arecIds.length) {
        const { data: arp } = await sb.from("receipt_payments").select("amount, payment_methods(affects_cash)").in("receipt_id", arecIds);
        for (const p of arp ?? []) if (rel<{ affects_cash: boolean }>(p.payment_methods)?.affects_cash) apoyoCash += Number(p.amount);
      }
    }
  }

  const opening = Number(s.opening_amount);
  const sold = (sales ?? []).reduce((a, x) => a + Number(x.total), 0) - cambio;
  const expenses = Number(s.cash_expenses ?? 0);
  // Sesión cerrada: usa lo que guardó el cierre (ya contempla gastos y apoyos).
  // Sesión abierta: estima en vivo.
  const expectedCash = s.expected_cash != null ? Number(s.expected_cash) : opening + cash + apoyoCash - expenses;
  const declared = s.declared_amount == null ? null : Number(s.declared_amount);
  const diff = s.cash_difference != null ? Number(s.cash_difference) : (declared == null ? null : declared - expectedCash);
  const openerName = (opener as { full_name: string | null; email: string | null } | null);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/caja" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a caja
      </Link>

      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Caja · {rel<{ name: string }>(s.stores)?.name ?? "—"}</h1>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              {openerName && <span>Cajero: {openerName.full_name || openerName.email}</span>}
              <span>Abierta {formatDateTime(s.opened_at)}</span>
              {s.closed_at && <span>Cerrada {formatDateTime(s.closed_at)}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${s.role === "apoyo" ? "bg-canvas text-muted" : "bg-accent-soft text-accent"}`}>{s.role === "apoyo" ? "Apoyo" : "Titular"}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${(STATUS[s.status] ?? STATUS.abierta).cls}`}>{(STATUS[s.status] ?? STATUS.abierta).label}</span>
          </div>
        </div>
        {s.notes && <p className="mt-3 border-t border-line pt-3 text-sm text-muted">Notas: {s.notes}</p>}
      </div>

      {s.status === "abierta" && canAdmin && <CerrarCajaAdmin sessionId={s.id} isTitular={s.role !== "apoyo"} />}

      {s.role === "apoyo" ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Tile label="Vendido (neto)" value={formatMoney(sold)} />
            <Tile label="Efectivo cobrado" value={formatMoney(cash)} accent />
          </div>
          <p className="mb-5 rounded-xl border border-line bg-canvas px-4 py-3 text-sm text-muted">Caja de apoyo: <span className="font-medium text-ink">rinde a la caja titular</span> — sin arqueo propio. El efectivo cobrado se consolida en el arqueo del titular.</p>
        </>
      ) : (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Tile label="Fondo" value={formatMoney(opening)} />
          <Tile label="Vendido (neto)" value={formatMoney(sold)} />
          <Tile label="Efectivo esperado" value={formatMoney(expectedCash)} accent />
          <Tile label="Declarado" value={declared == null ? "—" : formatMoney(declared)} />
          <Tile label="Diferencia" value={diff == null ? "—" : `${diff > 0 ? "+" : ""}${formatMoney(diff)}`} tone={diff == null ? undefined : diff === 0 ? "ok" : "danger"} />
        </div>
      )}
      {s.role !== "apoyo" && apoyoCash > 0 && (
        <p className="mb-5 -mt-2 text-xs text-muted">El efectivo esperado incluye {formatMoney(apoyoCash)} rendido por las cajas de apoyo de este turno.</p>
      )}
      {expenses > 0 && (
        <p className="mb-5 -mt-2 text-xs text-muted">Se descontaron {formatMoney(expenses)} de <span className="font-medium text-ink">gastos en efectivo</span> del turno (se rinden por fuera del sistema).</p>
      )}

      {s.kept_amount != null && (
        <div className="mb-5 flex flex-wrap gap-x-6 gap-y-1 rounded-xl bg-canvas px-4 py-3 text-sm">
          <span className="text-muted">Quedó en caja chica: <span className="font-medium text-ink">{formatMoney(Number(s.kept_amount))}</span></span>
          <span className="text-muted">Pasó a caja fuerte: <span className="font-medium text-accent">{formatMoney(Number(s.to_safe_amount ?? 0))}</span></span>
        </div>
      )}

      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <h2 className="mb-3 text-sm font-medium text-ink">Por medio de pago</h2>
        {byMethod.size === 0 ? <p className="text-sm text-muted">Sin movimientos.</p> : [...byMethod.entries()].map(([name, amount]) => (
          <div key={name} className="flex justify-between py-1 text-sm"><span className="text-muted">{name}</span><span className="tabular-nums text-ink">{formatMoney(amount)}</span></div>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-card">
        <div className="border-b border-line px-5 py-3.5"><h2 className="text-sm font-medium text-ink">Movimientos</h2></div>
        {(sales ?? []).length === 0 && (receipts ?? []).length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Sin movimientos.</p>
        ) : (
          <div className="divide-y divide-line">
            {(sales ?? []).map((v) => (
              <Link key={v.id} href={`/ventas/${v.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
                <span className="text-sm font-medium text-ink">Venta #{v.number}{v.channel === "cambio" && <span className="ml-1 text-xs text-muted">(cambio)</span>}</span>
                <span className="text-xs text-muted">{rel<{ name: string }>(v.customers)?.name ?? "Consumidor final"}</span>
                <span className="ml-auto tabular-nums text-ink">{formatMoney(Number(v.total))}</span>
                <ExternalLink className="h-3.5 w-3.5 text-faint" />
              </Link>
            ))}
            {(receipts ?? []).map((r) => (
              <Link key={r.id} href={`/cobranzas/${r.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-canvas">
                <span className="text-sm font-medium text-ink">Cobranza #{r.number}</span>
                <span className="text-xs text-muted">{rel<{ name: string }>(r.customers)?.name ?? "—"}</span>
                <span className="ml-auto tabular-nums text-ink">{formatMoney(Number(r.total))}</span>
                <ExternalLink className="h-3.5 w-3.5 text-faint" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: "ok" | "danger" }) {
  const color = tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : accent ? "text-accent" : "text-ink";
  return (
    <div className="rounded-lg bg-canvas px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 text-base font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
