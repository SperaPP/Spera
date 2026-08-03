"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ScanLine, Trash2, Plus, Minus } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { verificarItem, crearDevolucion } from "@/app/(app)/devoluciones/actions";

type Ref = { id: string; name: string };
type Item = { variantId: string; name: string; label: string | null; quantity: number; unitPrice: number };

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";
const label = "mb-1.5 block text-sm font-medium text-ink";

export function NuevaDevolucionForm({ customers, stores }: { customers: Ref[]; stores: Ref[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [checking, setChecking] = useState(false);

  const total = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);

  async function addByCode(code: string) {
    if (!code.trim()) return;
    setChecking(true);
    const r = await verificarItem(customerId, code);
    setChecking(false);
    if (!r.ok) return toast.error(r.reason);
    setItems((prev) => {
      const i = prev.findIndex((x) => x.variantId === r.variantId);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: next[i].quantity + 1 };
        return next;
      }
      return [...prev, { variantId: r.variantId, name: r.name, label: r.label, quantity: 1, unitPrice: r.unitPrice }];
    });
    toast.success(`${r.name} agregado`);
  }

  function setQty(variantId: string, qty: number) {
    setItems((prev) => prev.flatMap((x) => (x.variantId === variantId ? (qty <= 0 ? [] : [{ ...x, quantity: qty }]) : [x])));
  }

  function submit() {
    if (!customerId) return toast.error("Elegí un cliente.");
    if (items.length === 0) return toast.error("Agregá al menos un ítem.");
    start(async () => {
      const res = await crearDevolucion({
        customerId,
        storeId,
        notes: notes || undefined,
        items: items.map((i) => ({ variantId: i.variantId, productName: i.name, variantLabel: i.label, quantity: i.quantity })),
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success(`Devolución #${res.number} creada (pendiente de aprobar)`);
      router.push("/devoluciones");
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
            <label className={label} htmlFor="store">Local (reingreso de stock)</label>
            <select id="store" className={input} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-card p-5">
        <label className={label}>Escaneá o pegá el código de la prenda</label>
        <div className="relative">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className={`${input} pl-9`}
            placeholder={checking ? "Verificando…" : "Código de barras / SKU + Enter"}
            disabled={checking}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const el = e.target as HTMLInputElement;
                addByCode(el.value);
                el.value = "";
              }
            }}
          />
        </div>

        {items.length > 0 && (
          <div className="mt-4 divide-y divide-line rounded-lg border border-line">
            {items.map((i) => (
              <div key={i.variantId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{i.name}</div>
                  {i.label && <div className="text-xs text-muted">{i.label}</div>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setQty(i.variantId, i.quantity - 1)} className="rounded-md border border-line-strong p-1 text-muted hover:text-ink"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="w-7 text-center text-sm tabular-nums">{i.quantity}</span>
                  <button onClick={() => setQty(i.variantId, i.quantity + 1)} className="rounded-md border border-line-strong p-1 text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /></button>
                </div>
                <div className="w-24 text-right text-sm font-medium tabular-nums text-ink">{formatMoney(i.quantity * i.unitPrice)}</div>
                <button onClick={() => setQty(i.variantId, 0)} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <label className={label} htmlFor="notes">Notas (opcional)</label>
          <input id="notes" className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motivo de la devolución" />
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <span className="text-sm text-muted">Total a acreditar</span>
          <span className="text-lg font-semibold tabular-nums text-ink">{formatMoney(total)}</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={() => router.push("/devoluciones")} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">Cancelar</button>
        <button type="button" onClick={submit} disabled={pending || items.length === 0} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Creando…" : "Crear devolución"}
        </button>
      </div>
    </div>
  );
}
