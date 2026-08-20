"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Vault, Send, SlidersHorizontal, X } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { ajustarCaja, entregarACentral } from "@/app/(app)/caja/actions";

type Cashier = { id: string; name: string };
type StoreRow = { id: string; name: string; safe: number; petty: { cashierId: string; name: string; balance: number }[]; cashiers: Cashier[] };

const input =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15";

export function CajaAdmin({ stores, canAdmin }: { stores: StoreRow[]; canAdmin: boolean }) {
  const [entregar, setEntregar] = useState<StoreRow | null>(null);
  const [ajuste, setAjuste] = useState<StoreRow | null>(null);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {stores.map((s) => {
        const pettyTotal = s.petty.reduce((a, p) => a + p.balance, 0);
        return (
          <div key={s.id} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Vault className="h-4 w-4 text-muted" />
              <h3 className="font-medium text-ink">{s.name}</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-canvas px-3 py-2.5">
                <div className="text-xs text-muted">Caja fuerte</div>
                <div className="mt-0.5 text-xl font-bold tabular-nums text-accent">{formatMoney(s.safe)}</div>
              </div>
              <div className="rounded-lg bg-canvas px-3 py-2.5">
                <div className="text-xs text-muted">Caja chica (total)</div>
                <div className="mt-0.5 text-xl font-bold tabular-nums text-ink">{formatMoney(pettyTotal)}</div>
              </div>
            </div>
            {s.petty.length > 0 && (
              <div className="mt-3 space-y-0.5 border-t border-line pt-3 text-sm">
                {s.petty.map((p) => (
                  <div key={p.cashierId} className="flex justify-between"><span className="text-muted">{p.name}</span><span className="tabular-nums text-ink">{formatMoney(p.balance)}</span></div>
                ))}
              </div>
            )}
            {canAdmin && (
              <div className="mt-4 flex gap-2">
                <button onClick={() => setEntregar(s)} disabled={s.safe <= 0} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50">
                  <Send className="h-4 w-4" /> Entregar a central
                </button>
                <button onClick={() => setAjuste(s)} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas">
                  <SlidersHorizontal className="h-4 w-4" /> Ajuste
                </button>
              </div>
            )}
          </div>
        );
      })}

      {entregar && <EntregarModal store={entregar} onClose={() => setEntregar(null)} />}
      {ajuste && <AjusteModal store={ajuste} onClose={() => setAjuste(null)} />}
    </div>
  );
}

function EntregarModal({ store, onClose }: { store: StoreRow; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(store.safe));
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  return (
    <Modal title={`Entregar a Casa Central · ${store.name}`} onClose={onClose}>
      <p className="text-xs text-muted">Caja fuerte disponible: {formatMoney(store.safe)}. Queda registrado con fecha y hora.</p>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium text-muted">Monto a entregar</label>
        <input type="number" min={0} max={store.safe} className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium text-muted">Notas (opcional)</label>
        <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Remito, quién lo lleva…" />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button onClick={onClose} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
        <button
          onClick={() => {
            const n = Number(amount);
            if (!(n > 0)) return toast.error("Ingresá un monto.");
            start(async () => {
              const r = await entregarACentral(store.id, n, notes);
              if (r.error) { toast.error(r.error); return; }
              toast.success("Entrega registrada."); onClose(); router.refresh();
            });
          }}
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          {pending ? "Registrando…" : "Entregar"}
        </button>
      </div>
    </Modal>
  );
}

function AjusteModal({ store, onClose }: { store: StoreRow; onClose: () => void }) {
  const router = useRouter();
  const [target, setTarget] = useState<"chica" | "fuerte">("chica");
  const [cashierId, setCashierId] = useState(store.cashiers[0]?.id ?? "");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Modal title={`Ajuste de caja · ${store.name}`} onClose={onClose}>
      <p className="text-xs text-muted">Sumá o restá efectivo (usá negativo para restar). Fondo inicial o corrección de errores. Queda registrado.</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Destino</label>
          <select className={input} value={target} onChange={(e) => setTarget(e.target.value as "chica" | "fuerte")}>
            <option value="chica">Caja chica (cajero)</option>
            <option value="fuerte">Caja fuerte (local)</option>
          </select>
        </div>
        {target === "chica" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Cajero</label>
            <select className={input} value={cashierId} onChange={(e) => setCashierId(e.target.value)}>
              {store.cashiers.length === 0 && <option value="">Sin cajeros asignados</option>}
              {store.cashiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium text-muted">Monto (+ suma / − resta)</label>
        <input type="number" className={input} value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="Ej. 10000 o -5000" />
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium text-muted">Motivo</label>
        <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Fondo inicial, corrección de arqueo…" />
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button onClick={onClose} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
        <button
          onClick={() => {
            const n = Number(delta);
            if (!isFinite(n) || n === 0) return toast.error("Ingresá un monto distinto de cero.");
            if (target === "chica" && !cashierId) return toast.error("Elegí el cajero.");
            start(async () => {
              const r = await ajustarCaja({ storeId: store.id, target, cashierId: target === "chica" ? cashierId : null, delta: n, reason });
              if (r.error) { toast.error(r.error); return; }
              toast.success("Ajuste aplicado."); onClose(); router.refresh();
            });
          }}
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          {pending ? "Aplicando…" : "Aplicar ajuste"}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
