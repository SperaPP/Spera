"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { crearCobranza, pedidosPendientes, type PedidoPendiente } from "@/app/(app)/cobranzas/actions";

type Customer = { id: string; name: string; balance: number };
type Caja = { storeId: string; name: string; sessionId: string };
type Method = { id: string; name: string };
type Payment = { methodId: string; amount: string };

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";
const label = "mb-1.5 block text-sm font-medium text-ink";
const round2 = (n: number) => Math.round(n * 100) / 100;

export function NuevaCobranzaForm({ customers, openCajas, paymentMethods }: { customers: Customer[]; openCajas: Caja[]; paymentMethods: Method[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [cajaId, setCajaId] = useState(openCajas[0]?.sessionId ?? "");
  const [notes, setNotes] = useState("");
  const [payments, setPayments] = useState<Payment[]>([{ methodId: paymentMethods[0]?.id ?? "", amount: "" }]);
  const [pedidos, setPedidos] = useState<PedidoPendiente[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const debt = customer?.balance ?? 0;
  const collected = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const caja = openCajas.find((c) => c.sessionId === cajaId) ?? null;
  const allocTotal = round2(Object.values(alloc).reduce((a, v) => a + (Number(v) || 0), 0));

  // Cargar pedidos pendientes del cliente elegido.
  useEffect(() => {
    let alive = true;
    if (!customerId) { setPedidos([]); setAlloc({}); return; }
    pedidosPendientes(customerId).then((ps) => { if (alive) { setPedidos(ps); setAlloc({}); } });
    return () => { alive = false; };
  }, [customerId]);

  // Sugerencia FIFO: imputa a los pedidos más viejos hasta agotar lo cobrado.
  function sugerirFifo() {
    let left = collected;
    const next: Record<string, string> = {};
    for (const p of pedidos) {
      if (left <= 0.01) { next[p.id] = ""; continue; }
      const take = round2(Math.min(left, p.remaining));
      next[p.id] = take > 0 ? String(take) : "";
      left = round2(left - take);
    }
    setAlloc(next);
  }

  function submit() {
    if (!customerId) return toast.error("Elegí un cliente.");
    if (collected <= 0) return toast.error("Ingresá el monto a cobrar.");
    if (allocTotal > collected + 0.01) return toast.error("Estás imputando a pedidos más de lo que cobrás.");
    const allocations = pedidos
      .map((p) => ({ saleId: p.id, amount: Number(alloc[p.id]) || 0 }))
      .filter((a) => a.amount > 0);
    start(async () => {
      const res = await crearCobranza({
        customerId,
        storeId: caja?.storeId ?? null,
        cashSessionId: caja?.sessionId ?? null,
        notes: notes || undefined,
        payments: payments.filter((p) => p.methodId && Number(p.amount) > 0).map((p) => ({ paymentMethodId: p.methodId, amount: Number(p.amount) })),
        allocations: allocations.length ? allocations : undefined,
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success(`Cobranza #${res.number} registrada`);
      router.push("/cobranzas");
    });
  }

  const unallocated = round2(collected - allocTotal);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-card p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="customer">Cliente</label>
            <select id="customer" className={input} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="caja">Caja (para efectivo)</label>
            <select id="caja" className={input} value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
              <option value="">Sin caja</option>
              {openCajas.map((c) => <option key={c.sessionId} value={c.sessionId}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {customer && (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-canvas px-3 py-2 text-sm">
            <span className="text-muted">Saldo actual</span>
            <span className={`font-medium tabular-nums ${debt > 0 ? "text-danger" : debt < 0 ? "text-ok" : "text-ink"}`}>
              {debt > 0 ? `Debe ${formatMoney(debt)}` : debt < 0 ? `A favor ${formatMoney(-debt)}` : formatMoney(0)}
            </span>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-line bg-card p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Medios de cobro</span>
          {debt > 0 && (
            <button
              onClick={() => setPayments((p) => { const n = [...p]; if (n[0]) n[0] = { ...n[0], amount: String(debt) }; return n; })}
              className="text-xs text-accent hover:underline"
            >
              Cobrar deuda ({formatMoney(debt)})
            </button>
          )}
        </div>
        <div className="space-y-2">
          {payments.map((p, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select value={p.methodId} onChange={(e) => setPayments((arr) => arr.map((x, j) => j === idx ? { ...x, methodId: e.target.value } : x))} className={`${input} flex-1`}>
                {paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <input type="number" min={0} value={p.amount} onChange={(e) => setPayments((arr) => arr.map((x, j) => j === idx ? { ...x, amount: e.target.value } : x))} className={`${input} w-32`} placeholder="0" />
              {payments.length > 1 && (
                <button onClick={() => setPayments((arr) => arr.filter((_, j) => j !== idx))} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
          ))}
        </div>
        <button onClick={() => setPayments((p) => [...p, { methodId: paymentMethods[0]?.id ?? "", amount: "" }])} className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-ink">
          <Plus className="h-3.5 w-3.5" /> Agregar medio
        </button>

        <div className="mt-4">
          <label className={label} htmlFor="notes">Notas (opcional)</label>
          <input id="notes" className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referencia del cobro" />
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <span className="text-sm text-muted">Total a cobrar</span>
          <span className="text-lg font-semibold tabular-nums text-ink">{formatMoney(collected)}</span>
        </div>
      </div>

      {/* Imputación a pedidos: qué pedidos paga esta cobranza. */}
      {pedidos.length > 0 && (
        <div className="rounded-xl border border-line bg-card p-5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Aplicar a pedidos</span>
            <button onClick={sugerirFifo} className="text-xs text-accent hover:underline">Sugerir (más viejos)</button>
          </div>
          <p className="mb-3 text-xs text-muted">Un pedido queda pago (y despachable) cuando su saldo llega a cero. Lo no imputado queda como saldo a favor.</p>
          <div className="space-y-2">
            {pedidos.map((p) => {
              const val = Number(alloc[p.id]) || 0;
              const covered = val >= p.remaining - 0.01;
              return (
                <div key={p.id} className="flex items-center gap-3 rounded-lg bg-canvas px-3 py-2">
                  <div className="flex-1 text-sm">
                    <span className="font-medium text-ink">Pedido #{p.number}</span>
                    <span className="ml-2 text-xs text-muted">{new Date(p.date).toLocaleDateString("es-AR")} · debe {formatMoney(p.remaining)}</span>
                  </div>
                  {covered && val > 0 && <span className="rounded-full bg-ok-bg px-2 py-0.5 text-[11px] font-medium text-ok">Queda pago</span>}
                  <input
                    type="number" min={0} max={p.remaining}
                    value={alloc[p.id] ?? ""}
                    onChange={(e) => setAlloc((a) => ({ ...a, [p.id]: e.target.value }))}
                    className={`${input} w-32`} placeholder="0"
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm">
            <span className="text-muted">Imputado a pedidos</span>
            <span className={`font-medium tabular-nums ${allocTotal > collected + 0.01 ? "text-danger" : "text-ink"}`}>{formatMoney(allocTotal)}</span>
          </div>
          {allocTotal < 0.01 && collected > 0 && (
            <p className="mt-1 text-xs text-warn">⚠ No estás imputando a ningún pedido: el saldo baja pero <strong>ningún pedido se destraba para despacho</strong>. Usá &quot;Sugerir&quot; o tildá los que estás cobrando.</p>
          )}
          {unallocated > 0.01 && allocTotal >= 0.01 && (
            <p className="mt-1 text-xs text-muted">Sin imputar: {formatMoney(unallocated)} → queda como saldo a favor del cliente.</p>
          )}
          {allocTotal > collected + 0.01 && (
            <p className="mt-1 text-xs text-danger">Estás imputando más de lo que cobrás.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={() => router.push("/cobranzas")} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">Cancelar</button>
        <button type="button" onClick={submit} disabled={pending || collected <= 0 || allocTotal > collected + 0.01} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Registrando…" : "Registrar cobranza"}
        </button>
      </div>
    </div>
  );
}
