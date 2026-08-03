import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, HandCoins } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDateTime } from "@/lib/format";

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
  ajuste: "Ajuste",
};

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function ClienteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const [{ data: customer }, { data: movs }] = await Promise.all([
    sb.from("customers").select("id, name, fiscal_condition, balance, doc_type, doc_number, email, phone, customer_types(name)").eq("id", id).single(),
    sb.from("customer_movements").select("id, delta, reason, created_at").eq("customer_id", id).order("created_at", { ascending: true }),
  ]);
  if (!customer) notFound();

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
          <Link href="/cobranzas/nueva" className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas">
            <HandCoins className="h-4 w-4" />
            Cobrar
          </Link>
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
                  return (
                    <tr key={m.id} className="border-b border-line last:border-0">
                      <td className="px-5 py-2.5 text-muted">{formatDateTime(m.created_at)}</td>
                      <td className="px-5 py-2.5 text-ink">{REASON_LABEL[m.reason] ?? m.reason}</td>
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
    </div>
  );
}
