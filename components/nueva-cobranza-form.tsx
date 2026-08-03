"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { crearCobranza } from "@/app/(app)/cobranzas/actions";

type Customer = { id: string; name: string; balance: number };
type Caja = { storeId: string; name: string; sessionId: string };
type Method = { id: string; name: string };
type Payment = { methodId: string; amount: string };

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";
const label = "mb-1.5 block text-sm font-medium text-ink";

export function NuevaCobranzaForm({ customers, openCajas, paymentMethods }: { customers: Customer[]; openCajas: Caja[]; paymentMethods: Method[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [cajaId, setCajaId] = useState(openCajas[0]?.sessionId ?? "");
  const [notes, setNotes] = useState("");
  const [payments, setPayments] = useState<Payment[]>([{ methodId: paymentMethods[0]?.id ?? "", amount: "" }]);

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const debt = customer?.balance ?? 0;
  const collected = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const caja = openCajas.find((c) => c.sessionId === cajaId) ?? null;

  function submit() {
    if (!customerId) return toast.error("Elegí un cliente.");
    if (collected <= 0) return toast.error("Ingresá el monto a cobrar.");
    start(async () => {
      const res = await crearCobranza({
        customerId,
        storeId: caja?.storeId ?? null,
        cashSessionId: caja?.sessionId ?? null,
        notes: notes || undefined,
        payments: payments.filter((p) => p.methodId && Number(p.amount) > 0).map((p) => ({ paymentMethodId: p.methodId, amount: Number(p.amount) })),
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success(`Cobranza #${res.number} registrada`);
      router.push("/cobranzas");
    });
  }

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

      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={() => router.push("/cobranzas")} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">Cancelar</button>
        <button type="button" onClick={submit} disabled={pending || collected <= 0} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Registrando…" : "Registrar cobranza"}
        </button>
      </div>
    </div>
  );
}
