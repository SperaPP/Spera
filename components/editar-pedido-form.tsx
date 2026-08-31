"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Plus, Minus, Trash2, Save, X } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { listarProductosPOS } from "@/app/(app)/pos/actions";
import { editarPedido } from "@/app/(app)/ventas/actions";

type Item = { variantId: string; name: string; label: string | null; quantity: number; unitPrice: number; ceiling: number };
type GridProduct = Awaited<ReturnType<typeof listarProductosPOS>>[number];

const inputBase = "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

export function EditarPedidoForm({
  saleId, priceListId, warehouseId, initialItems,
}: {
  saleId: string; priceListId: string | null; warehouseId: string | null; initialItems: Item[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GridProduct[]>([]);
  const [pick, setPick] = useState<GridProduct | null>(null);
  const [pending, start] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onSearch(v: string) {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      if (v.trim().length < 2) { setResults([]); return; }
      setResults(await listarProductosPOS(v, priceListId, warehouseId));
    }, 250);
  }

  function addVariant(variantId: string, name: string, label: string | null, price: number | null, stock: number) {
    setItems((prev) => {
      const i = prev.findIndex((x) => x.variantId === variantId);
      const tag = `${name}${label ? ` ${label}` : ""}`;
      if (i >= 0) {
        if (prev[i].quantity >= prev[i].ceiling) { toast.error(`${tag}: sin más stock (máx ${prev[i].ceiling})`); return prev; }
        const next = [...prev];
        next[i] = { ...next[i], quantity: next[i].quantity + 1 };
        return next;
      }
      if (stock <= 0) { toast.error(`${tag}: sin stock`); return prev; }
      return [...prev, { variantId, name, label, quantity: 1, unitPrice: price ?? 0, ceiling: stock }];
    });
  }

  function onProduct(p: GridProduct) {
    if (p.variants.length <= 1) {
      const v = p.variants[0];
      if (!v) return toast.error("El producto no tiene variantes.");
      addVariant(v.id, p.name, v.label, p.price, v.stock);
    } else setPick(p);
  }

  function setQty(variantId: string, qty: number) {
    setItems((prev) => prev.flatMap((x) => (x.variantId === variantId ? (qty <= 0 ? [] : [{ ...x, quantity: Math.min(qty, x.ceiling) }]) : [x])));
  }
  function remove(variantId: string) { setItems((prev) => prev.filter((x) => x.variantId !== variantId)); }

  const subtotal = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const dirty = JSON.stringify(items.map((i) => [i.variantId, i.quantity])) !== JSON.stringify(initialItems.map((i) => [i.variantId, i.quantity]));

  function save() {
    if (items.length === 0) return toast.error("El pedido no puede quedar sin ítems.");
    start(async () => {
      const r = await editarPedido(saleId, items.map((i) => ({ variantId: i.variantId, productName: i.name, variantLabel: i.label, quantity: i.quantity, unitPrice: i.unitPrice })));
      if (r.error) { toast.error(r.error); return; }
      toast.success("Pedido actualizado.");
      router.push(`/ventas/${saleId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Ítems actuales */}
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        <div className="border-b border-line px-5 py-3.5"><h2 className="text-sm font-medium text-ink">Ítems del pedido</h2></div>
        {items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Sin ítems. Agregá productos abajo.</p>
        ) : (
          <div className="divide-y divide-line">
            {items.map((i) => (
              <div key={i.variantId} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{i.name}</div>
                  <div className="text-xs text-muted">{i.label ? `${i.label} · ` : ""}{formatMoney(i.unitPrice)}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setQty(i.variantId, i.quantity - 1)} className="rounded-md border border-line-strong p-1 text-ink hover:bg-canvas"><Minus className="h-3.5 w-3.5" /></button>
                  <input
                    type="number" min={0} max={i.ceiling} value={i.quantity}
                    onChange={(e) => setQty(i.variantId, Number(e.target.value) || 0)}
                    className="w-14 rounded-md border border-line-strong bg-card px-2 py-1 text-center text-sm tabular-nums text-ink outline-none focus:border-accent"
                  />
                  <button onClick={() => setQty(i.variantId, i.quantity + 1)} disabled={i.quantity >= i.ceiling} className="rounded-md border border-line-strong p-1 text-ink hover:bg-canvas disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                </div>
                <div className="w-24 text-right text-sm font-semibold tabular-nums text-ink">{formatMoney(i.quantity * i.unitPrice)}</div>
                <button onClick={() => remove(i.variantId)} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="text-sm text-muted">Subtotal</span>
          <span className="text-lg font-semibold tabular-nums text-ink">{formatMoney(subtotal)}</span>
        </div>
      </div>

      {/* Buscar y agregar */}
      <div className="rounded-xl border border-line bg-card p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input value={query} onChange={(e) => onSearch(e.target.value)} placeholder="Buscar producto por nombre para agregar…" className={`${inputBase} pl-9`} />
        </div>
        {results.length > 0 && (
          <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
            {results.map((p) => (
              <button key={p.id} onClick={() => onProduct(p)} disabled={p.stock <= 0}
                className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left transition-colors hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                  <span className="text-xs text-muted">{p.stock <= 0 ? "sin stock" : `${p.stock} disp.`}{p.variants.length > 1 ? ` · ${p.variants.length} variantes` : ""}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{p.price != null ? formatMoney(p.price) : "sin precio"}</span>
                <Plus className="h-4 w-4 shrink-0 text-accent" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Guardar */}
      <div className="flex justify-end gap-3">
        <button onClick={() => router.push(`/ventas/${saleId}`)} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
        <button onClick={save} disabled={pending || items.length === 0 || !dirty} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
          <Save className="h-4 w-4" /> {pending ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>

      {/* Modal de variantes */}
      {pick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPick(null)}>
          <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{pick.name}</div>
                <div className="text-xs text-muted">{pick.price != null ? formatMoney(pick.price) : "sin precio"} · elegí la variante</div>
              </div>
              <button onClick={() => setPick(null)} className="rounded-md p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {pick.variants.map((v) => (
                <button key={v.id} disabled={v.stock <= 0}
                  onClick={() => { addVariant(v.id, pick.name, v.label, pick.price, v.stock); setPick(null); }}
                  className="flex items-center justify-between gap-2 rounded-lg border border-line-strong px-3 py-2 text-left text-sm transition-colors hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50">
                  <span>{v.label ?? "Único"}</span>
                  <span className={`text-[11px] font-normal tabular-nums ${v.stock <= 0 ? "text-danger" : "text-muted"}`}>{v.stock <= 0 ? "sin stock" : `${v.stock} disp.`}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
