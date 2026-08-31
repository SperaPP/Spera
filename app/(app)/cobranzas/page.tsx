import Link from "next/link";
import { Plus, HandCoins } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDateTime } from "@/lib/format";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

// Medios que NO son dinero que ingresa (deuda / crédito reusado): se excluyen del total cobrado.
const NO_MONEY = new Set(["cuenta_corriente", "saldo_favor", "cambio"]);

const CHANNEL_LABEL: Record<string, string> = {
  pos: "Venta", portal: "Venta portal", tiendanube: "Venta TN", cambio: "Cambio",
};

type Ingreso = {
  key: string; id: string; date: string; cliente: string; monto: number;
  kind: "cobranza" | "venta"; label: string; href: string; anulada: boolean;
};

export default async function CobranzasPage() {
  const sb = await createClient();

  // 1) Cobranzas (receipts): todo el receipt es dinero real (create_receipt lo valida).
  // 2) Ventas: la parte cobrada en dinero real (excluye cuenta corriente / saldo a favor / cambio).
  const [{ data: receipts }, { data: sales }] = await Promise.all([
    sb.from("receipts")
      .select("id, number, total, created_at, status, customers(name)")
      .order("created_at", { ascending: false }).limit(150),
    sb.from("sales")
      .select("id, number, created_at, status, channel, customer_name, customers(name), sale_payments(amount, payment_methods(kind))")
      .neq("status", "anulada")
      .order("created_at", { ascending: false }).limit(250),
  ]);

  const ingresos: Ingreso[] = [];

  for (const r of receipts ?? []) {
    ingresos.push({
      key: `r-${r.id}`, id: r.id, date: r.created_at as string,
      cliente: relName(r.customers) ?? "—", monto: Number(r.total),
      kind: "cobranza", label: `Cobranza #${r.number}`, href: `/cobranzas/${r.id}`,
      anulada: r.status === "anulada",
    });
  }

  for (const s of sales ?? []) {
    const pays = (s.sale_payments ?? []) as { amount: number; payment_methods: unknown }[];
    const real = pays.reduce((a, p) => {
      const kind = (Array.isArray(p.payment_methods) ? p.payment_methods[0] : p.payment_methods) as { kind: string } | null;
      return a + (kind && !NO_MONEY.has(kind.kind) ? Number(p.amount) : 0);
    }, 0);
    if (real <= 0) continue; // venta 100% a cuenta corriente: no ingresó dinero (se cobra después)
    ingresos.push({
      key: `s-${s.id}`, id: s.id, date: s.created_at as string,
      cliente: relName(s.customers) ?? s.customer_name ?? "Consumidor final", monto: real,
      kind: "venta", label: `${CHANNEL_LABEL[s.channel] ?? "Venta"} #${s.number}`, href: `/ventas/${s.id}`,
      anulada: false,
    });
  }

  ingresos.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const rows = ingresos.slice(0, 100);
  const totalIngresado = rows.filter((r) => !r.anulada).reduce((a, r) => a + r.monto, 0);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Cobranzas</h1>
          <p className="mt-1 text-sm text-muted">Todo el dinero que ingresa: cobranzas a cuenta corriente y cobros de ventas (todos los canales).</p>
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
          <p className="mt-3 font-medium text-ink">Todavía no hay ingresos</p>
          <p className="mt-1 text-sm text-muted">Los cobros de ventas y las cobranzas van a aparecer acá.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Comprobante</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 text-right font-medium">Cobrado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDateTime(r.date)}</td>
                  <td className="px-4 py-3">
                    <Link href={r.href} className="font-medium text-accent transition-colors hover:underline">{r.label}</Link>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${r.kind === "cobranza" ? "bg-accent-soft text-accent" : "bg-canvas text-muted"}`}>
                      {r.kind === "cobranza" ? "Cobranza" : "Venta"}
                    </span>
                    {r.anulada && <span className="ml-2 rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-medium text-danger">Anulada</span>}
                  </td>
                  <td className="px-4 py-3 text-ink">{r.cliente}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${r.anulada ? "text-faint line-through" : "text-ink"}`}>{formatMoney(r.monto)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-canvas/50">
                <td colSpan={3} className="px-4 py-3 text-sm font-medium text-ink">Total ingresado (últimos {rows.length})</td>
                <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-ink">{formatMoney(totalIngresado)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
