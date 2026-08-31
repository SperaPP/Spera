"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Plus, Minus, Trash2, Save, Check } from "lucide-react";
import { buscarProductosTransferencia, editarTransferencia } from "@/app/(app)/transferencias/actions";

type Item = { variantId: string; name: string; label: string | null; quantity: number; ceiling: number };
type ProdResult = { id: string; name: string; variants: { variantId: string; label: string | null; available: number }[] };

const inputBase = "rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function EditarTransferenciaForm({
  transferId, fromWarehouseId, initialItems,
}: {
  transferId: string; fromWarehouseId: string; initialItems: Item[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ProdResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    let alive = true;
    setSearching(true);
    const tmr = setTimeout(async () => {
      const r = await buscarProductosTransferencia(term, fromWarehouseId);
      if (alive) { setResults(r); setSearching(false); }
    }, 300);
    return () => { alive = false; clearTimeout(tmr); };
  }, [q, fromWarehouseId]);

  function addVariant(variantId: string, name: string, label: string | null, available: number) {
    setItems((prev) => {
      const i = prev.findIndex((x) => x.variantId === variantId);
      if (i >= 0) {
        if (prev[i].quantity >= prev[i].ceiling) { toast.error(`${name}: sin más stock (máx ${prev[i].ceiling})`); return prev; }
        const n = [...prev]; n[i] = { ...n[i], quantity: n[i].quantity + 1 }; return n;
      }
      if (available <= 0) { toast.error(`${name}: sin stock en el origen`); return prev; }
      return [...prev, { variantId, name, label, quantity: 1, ceiling: available }];
    });
  }

  function setQty(variantId: string, qty: number) {
    setItems((prev) => prev.flatMap((x) => (x.variantId === variantId ? (qty <= 0 ? [] : [{ ...x, quantity: Math.min(qty, x.ceiling) }]) : [x])));
  }

  const inCart = new Set(items.map((i) => i.variantId));
  const dirty = JSON.stringify(items.map((i) => [i.variantId, i.quantity])) !== JSON.stringify(initialItems.map((i) => [i.variantId, i.quantity]));

  function save() {
    if (items.length === 0) return toast.error("La transferencia no puede quedar sin ítems.");
    start(async () => {
      const r = await editarTransferencia(transferId, items.map((i) => ({ variantId: i.variantId, productName: i.name, quantity: i.quantity })));
      if (r.error) { toast.error(r.error); return; }
      toast.success("Transferencia actualizada.");
      router.push(`/transferencias/${transferId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Ítems actuales */}
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        <div className="border-b border-line px-5 py-3.5"><h2 className="text-sm font-medium text-ink">A transferir</h2></div>
        {items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Sin ítems. Agregá productos abajo.</p>
        ) : (
          <div className="divide-y divide-line">
            {items.map((i) => (
              <div key={i.variantId} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{i.name}</div>
                  <div className="text-xs text-muted">{i.label ? `${i.label} · ` : ""}máx {i.ceiling}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setQty(i.variantId, i.quantity - 1)} className="rounded-md border border-line-strong p-1 text-ink hover:bg-canvas"><Minus className="h-3.5 w-3.5" /></button>
                  <input type="number" min={0} max={i.ceiling} value={i.quantity}
                    onChange={(e) => setQty(i.variantId, Number(e.target.value) || 0)}
                    className={`${inputBase} w-14 py-1 text-center tabular-nums`} />
                  <button onClick={() => setQty(i.variantId, i.quantity + 1)} disabled={i.quantity >= i.ceiling} className="rounded-md border border-line-strong p-1 text-ink hover:bg-canvas disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                </div>
                <button onClick={() => setQty(i.variantId, 0)} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Buscar y agregar */}
      <div className="rounded-xl border border-line bg-card p-5">
        <label className="mb-1.5 block text-sm font-medium text-ink">Agregar producto (por nombre)</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input className={`w-full ${inputBase} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej: Pantalón Nia, Buzo…" />
        </div>
        {q.trim().length >= 2 && (
          <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-line">
            {searching && results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Buscando…</p>
            ) : results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Sin resultados con stock en el origen.</p>
            ) : (
              results.map((p) => (
                <div key={p.id} className="border-b border-line last:border-0">
                  <div className="bg-canvas px-4 py-2 text-sm font-medium text-ink">{p.name}</div>
                  <div className="divide-y divide-line">
                    {p.variants.map((v) => (
                      <button key={v.variantId} type="button" onClick={() => addVariant(v.variantId, p.name, v.label, v.available)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-canvas">
                        <span className="flex-1 text-sm text-ink">{v.label ?? "Única"}</span>
                        <span className="text-xs tabular-nums text-muted">disp. {v.available}</span>
                        {inCart.has(v.variantId) ? <Check className="h-4 w-4 text-ok" /> : <Plus className="h-4 w-4 text-accent" />}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={() => router.push(`/transferencias/${transferId}`)} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
        <button type="button" onClick={save} disabled={pending || items.length === 0 || !dirty} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
          <Save className="h-4 w-4" /> {pending ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}
