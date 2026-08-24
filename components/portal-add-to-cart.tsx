"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { useCart } from "@/components/portal-cart";

type Variant = { id: string; label: string | null; stock: number };

export function PortalAddToCart({
  productId, name, price, image, variants,
}: { productId: string; name: string; price: number; image: string | null; variants: Variant[] }) {
  const { add } = useCart();
  const [qty, setQty] = useState<Record<string, number>>({});

  const set = (id: string, n: number, max: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, n)) }));
  const anySelected = Object.values(qty).some((n) => n > 0);

  function agregar() {
    let added = 0;
    for (const v of variants) {
      const n = qty[v.id] ?? 0;
      if (n > 0) { add({ variantId: v.id, productId, name, label: v.label, price, qty: n, image, maxStock: v.stock }); added += n; }
    }
    if (added === 0) return toast.error("Elegí una cantidad.");
    setQty({});
    toast.success(`${added} agregada(s) al pedido.`);
  }

  if (variants.length === 0) return <p className="text-sm text-muted">Sin stock por el momento.</p>;

  return (
    <div>
      <div className="space-y-2">
        {variants.map((v) => {
          const n = qty[v.id] ?? 0;
          return (
            <div key={v.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{v.label ?? "Único"}</div>
                <div className="text-xs text-muted">{v.stock} disponibles</div>
              </div>
              <div className="flex items-center rounded-lg border border-line-strong">
                <button onClick={() => set(v.id, n - 1, v.stock)} className="p-1.5 text-muted hover:text-ink"><Minus className="h-3.5 w-3.5" /></button>
                <input value={n} onChange={(e) => set(v.id, Number(e.target.value) || 0, v.stock)} className="w-10 border-0 bg-transparent text-center text-sm tabular-nums outline-none" />
                <button onClick={() => set(v.id, n + 1, v.stock)} className="p-1.5 text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={agregar} disabled={!anySelected} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50">
        <ShoppingCart className="h-4 w-4" /> Agregar al pedido
      </button>
    </div>
  );
}
