import { getPortalCustomer } from "@/lib/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney, formatDateTime } from "@/lib/format";

const REASON: Record<string, string> = {
  venta: "Pedido", cobranza: "Pago", devolucion: "Devolución", cambio: "Cambio",
  saldo_favor: "Saldo a favor", sobrepago: "A favor", anulacion: "Anulación", ajuste: "Ajuste",
};

export default async function PortalCuenta() {
  const { customer } = await getPortalCustomer();
  const admin = createAdminClient();
  const { data: movs } = await admin
    .from("customer_movements")
    .select("id, delta, reason, note, created_at")
    .eq("customer_id", customer!.id)
    .order("created_at", { ascending: true });

  let running = 0;
  const rows = (movs ?? []).map((m) => { running += Number(m.delta); return { ...m, balance: running }; }).reverse();
  const balance = customer!.balance;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-ink">Mi cuenta</h1>

      <div className="mb-5 flex items-center justify-between rounded-xl border border-line bg-card p-5">
        <span className="text-sm text-muted">Saldo de cuenta corriente</span>
        <span className={`text-xl font-semibold tabular-nums ${balance > 0 ? "text-danger" : balance < 0 ? "text-ok" : "text-ink"}`}>
          {balance > 0 ? `Debés ${formatMoney(balance)}` : balance < 0 ? `A favor ${formatMoney(-balance)}` : formatMoney(0)}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-card">
        <div className="border-b border-line px-5 py-3.5"><h2 className="text-sm font-medium text-ink">Movimientos</h2></div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Sin movimientos.</p>
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
                      <td className="px-5 py-2.5 text-ink">{REASON[m.reason] ?? m.reason}{m.note && <span className="block text-xs text-muted">{m.note}</span>}</td>
                      <td className={`px-5 py-2.5 text-right tabular-nums ${delta > 0 ? "text-danger" : "text-ok"}`}>{delta > 0 ? "+" : ""}{formatMoney(delta)}</td>
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
