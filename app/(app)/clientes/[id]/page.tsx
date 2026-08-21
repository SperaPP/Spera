import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, HandCoins, Pencil, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDateTime } from "@/lib/format";
import { AjusteSaldoButton } from "@/components/ajuste-saldo-button";

/** Link al comprobante que originó el movimiento de cuenta corriente. */
function movHref(referenceType: string | null, referenceId: string | null): string | null {
  if (!referenceId) return null;
  if (referenceType === "sale" || referenceType === "sale_cancel" || referenceType === "exchange") return `/ventas/${referenceId}`;
  if (referenceType === "receipt") return `/cobranzas/${referenceId}`;
  return null;
}

const FISCAL_LABEL: Record<string, string> = {
  consumidor_final: "Consumidor Final",
  responsable_inscripto: "Responsable Inscripto",
  monotributo: "Monotributo",
  exento: "Exento",
};
const REASON_LABEL: Record<string, string> = {
  venta: "Venta",
  cobranza: "Cobranza",
  devolucion: "Devolución",
  cambio: "Cambio",
  saldo_favor: "Saldo a favor",
  sobrepago: "Sobrepago",
  anulacion: "Anulación",
  ajuste: "Ajuste",
};

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function ClienteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const [{ data: customer }, { data: movs }, { data: isAdmin }] = await Promise.all([
    sb.from("customers").select("id, name, fiscal_condition, balance, doc_type, doc_number, email, phone, customer_types(name)").eq("id", id).single(),
    sb.from("customer_movements").select("id, delta, reason, note, created_at, reference_type, reference_id").eq("customer_id", id).order("created_at", { ascending: true }),
    sb.rpc("is_admin"),
  ]);
  if (!customer) notFound();

  // Historial de compras: TODAS las ventas del cliente (contado incluido).
  const { data: sales } = await sb
    .from("sales")
    .select("id, number, created_at, total, status, channel")
    .eq("customer_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  const compras = sales ?? [];
  const totalComprado = compras.filter((s) => s.status !== "anulada").reduce((a, s) => a + Number(s.total), 0);

  // Saldo corriente acumulado por movimiento (más nuevo primero para mostrar).
  let running = 0;
  const rows = (movs ?? []).map((m) => {
    running += Number(m.delta);
    return { ...m, balance: running };
  }).reverse();

  const balance = Number(customer.balance);

  const infoField = (label: string, value: string | null) =>
    value ? (
      <div className="text-sm">
        <span className="text-muted">{label}: </span>
        <span className="text-ink">{value}</span>
      </div>
    ) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/clientes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        Volver a clientes
      </Link>

      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{customer.name}</h1>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {infoField("Tipo", relName(customer.customer_types))}
              {infoField("Cond. fiscal", FISCAL_LABEL[customer.fiscal_condition] ?? customer.fiscal_condition)}
              {infoField(customer.doc_type ?? "Doc", customer.doc_number)}
              {infoField("Email", customer.email)}
              {infoField("Teléfono", customer.phone)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href={`/clientes/${customer.id}/editar`} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas">
              <Pencil className="h-4 w-4" />
              Editar
            </Link>
            <Link href="/cobranzas/nueva" className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas">
              <HandCoins className="h-4 w-4" />
              Cobrar
            </Link>
            {isAdmin === true && <AjusteSaldoButton customerId={customer.id} balance={balance} />}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <span className="text-sm text-muted">Saldo de cuenta corriente</span>
          <span className={`text-lg font-semibold tabular-nums ${balance > 0 ? "text-danger" : balance < 0 ? "text-ok" : "text-ink"}`}>
            {balance > 0 ? `Debe ${formatMoney(balance)}` : balance < 0 ? `A favor ${formatMoney(-balance)}` : formatMoney(0)}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-card">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-medium text-ink">Movimientos</h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Sin movimientos de cuenta corriente.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-5 py-2.5 font-medium">Fecha</th>
                  <th className="px-5 py-2.5 font-medium">Concepto</th>
                  <th className="px-5 py-2.5 text-right font-medium">Importe</th>
                  <th className="px-5 py-2.5 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const delta = Number(m.delta);
                  const href = movHref(m.reference_type, m.reference_id);
                  return (
                    <tr key={m.id} className="border-b border-line last:border-0 hover:bg-canvas">
                      <td className="px-5 py-2.5 text-muted">{formatDateTime(m.created_at)}</td>
                      <td className="px-5 py-2.5">
                        {href ? (
                          <Link href={href} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                            {REASON_LABEL[m.reason] ?? m.reason} <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        ) : (
                          <span className="text-ink">{REASON_LABEL[m.reason] ?? m.reason}</span>
                        )}
                        {m.note && <div className="text-xs text-muted">{m.note}</div>}
                      </td>
                      <td className={`px-5 py-2.5 text-right tabular-nums ${delta > 0 ? "text-danger" : "text-ok"}`}>
                        {delta > 0 ? "+" : ""}{formatMoney(delta)}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-ink">{formatMoney(m.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-5 rounded-xl border border-line bg-card">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-medium text-ink">Historial de compras</h2>
          {compras.length > 0 && (
            <span className="text-xs text-muted">{compras.filter((s) => s.status !== "anulada").length} compra(s) · total {formatMoney(totalComprado)}</span>
          )}
        </div>
        {compras.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Este cliente todavía no tiene compras.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-5 py-2.5 font-medium">Fecha</th>
                  <th className="px-5 py-2.5 font-medium">Pedido</th>
                  <th className="px-5 py-2.5 text-right font-medium">Total</th>
                  <th className="px-5 py-2.5 font-medium">Estado</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {compras.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-5 py-2.5 text-muted">{formatDateTime(s.created_at)}</td>
                    <td className="px-5 py-2.5 font-medium text-ink">
                      #{s.number}
                      {s.channel === "cambio" && <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted">Cambio</span>}
                    </td>
                    <td className={`px-5 py-2.5 text-right tabular-nums ${s.status === "anulada" ? "text-faint line-through" : "text-ink"}`}>{formatMoney(Number(s.total))}</td>
                    <td className="px-5 py-2.5">
                      {s.status === "anulada"
                        ? <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-medium text-danger">Anulada</span>
                        : <span className="rounded-full bg-ok-bg px-2 py-0.5 text-xs font-medium text-ok">Completada</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Link href={`/ventas/${s.id}`} className="inline-flex items-center gap-1 text-accent hover:underline">Ver <ExternalLink className="h-3.5 w-3.5" /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
