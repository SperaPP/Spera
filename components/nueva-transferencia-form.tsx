"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ScanLine, Trash2, ArrowRight } from "lucide-react";
import { buscarVarianteTransferencia, crearTransferencia } from "@/app/(app)/transferencias/actions";

type Ref = { id: string; name: string };
type Item = { variantId: string; name: string; label: string | null; quantity: number; available: number };

const inputBase =
  "rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";
const input = `w-full ${inputBase}`;
const label = "mb-1.5 block text-sm font-medium text-ink";

export function NuevaTransferenciaForm({ warehouses }: { warehouses: Ref[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fromWh, setFromWh] = useState(warehouses[0]?.id ?? "");
  const [toWh, setToWh] = useState(warehouses[1]?.id ?? warehouses[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [checking, setChecking] = useState(false);

  function changeFrom(id: string) {
    setFromWh(id);
    if (items.length) {
      setItems([]);
      toast.info("Se limpió la lista al cambiar el origen (cambia la disponibilidad).");
    }
  }

  async function addByCode(code: string) {
    if (!code.trim()) return;
    setChecking(true);
    const r = await buscarVarianteTransferencia(code, fromWh);
    setChecking(false);
    if (!r.ok) return toast.error(r.reason);
    if (r.available <= 0) return toast.error(`${r.name}: sin stock en el origen.`);
    setItems((prev) => {
      const i = prev.findIndex((x) => x.variantId === r.variantId);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: Math.min(next[i].quantity + 1, r.available) };
        return next;
      }
      return [...prev, { variantId: r.variantId, name: r.name, label: r.label, quantity: 1, available: r.available }];
    });
  }

  function setQty(variantId: string, qty: number) {
    setItems((prev) => prev.flatMap((x) => (x.variantId === variantId ? (qty <= 0 ? [] : [{ ...x, quantity: Math.min(qty, x.available) }]) : [x])));
  }

  function submit() {
    if (fromWh === toWh) return toast.error("El origen y el destino deben ser distintos.");
    if (items.length === 0) return toast.error("Agregá al menos un ítem.");
    start(async () => {
      const res = await crearTransferencia({
        fromWh, toWh, notes: notes || undefined,
        items: items.map((i) => ({ variantId: i.variantId, productName: i.name, quantity: i.quantity })),
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success("Transferencia realizada.");
      router.push("/transferencias");
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-card p-5">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className={label} htmlFor="from">Origen</label>
            <select id="from" className={input} value={fromWh} onChange={(e) => changeFrom(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <ArrowRight className="mb-2.5 h-4 w-4 shrink-0 text-faint" />
          <div className="flex-1">
            <label className={label} htmlFor="to">Destino</label>
            <select id="to" className={input} value={toWh} onChange={(e) => setToWh(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
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
                  <div className="text-xs text-muted">{i.label ? `${i.label} · ` : ""}disp. {i.available}</div>
                </div>
                <input
                  type="number" min={1} max={i.available} value={i.quantity}
                  onChange={(e) => setQty(i.variantId, Number(e.target.value) || 0)}
                  className={`${inputBase} w-20 shrink-0 py-1.5 text-center`}
                />
                <button onClick={() => setQty(i.variantId, 0)} className="shrink-0 text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <label className={label} htmlFor="notes">Notas (opcional)</label>
          <input id="notes" className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Remito, motivo…" />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={() => router.push("/transferencias")} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">Cancelar</button>
        <button type="button" onClick={submit} disabled={pending || items.length === 0} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Transfiriendo…" : "Realizar transferencia"}
        </button>
      </div>
    </div>
  );
}
