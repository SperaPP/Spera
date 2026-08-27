"use client";

import { useState } from "react";
import { Plus, X, ImageOff } from "lucide-react";
import { productoPortal } from "@/app/portal/actions";
import { PortalVariantMatrix } from "@/components/portal-variant-matrix";
import { formatMoney } from "@/lib/format";
import type { PortalProduct } from "@/lib/portal-catalog";

export function PortalQuickAdd({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false);
  const [prod, setProd] = useState<PortalProduct | null>(null);
  const [loading, setLoading] = useState(false);

  async function abrir(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation(); // la card es un Link: no navegar
    setOpen(true); setLoading(true); setProd(null);
    const p = await productoPortal(productId);
    setProd(p); setLoading(false);
  }
  const close = () => { setOpen(false); setProd(null); };

  return (
    <>
      <button
        onClick={abrir}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-soft py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-fg"
      >
        <Plus className="h-3.5 w-3.5" /> Agregar
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]" onClick={close}>
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-ink">{prod?.name ?? "Cargando…"}</h2>
                {prod && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-bold tabular-nums text-accent">{formatMoney(prod.price)}</span>
                    {prod.publicPrice != null && prod.publicPrice > prod.price && (
                      <span className="text-xs tabular-nums text-faint">Público {formatMoney(prod.publicPrice)}</span>
                    )}
                  </div>
                )}
              </div>
              <button type="button" onClick={close} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink"><X className="h-4 w-4" /></button>
            </div>

            <div className="p-5">
              {loading ? (
                <p className="py-10 text-center text-sm text-muted">Cargando el producto…</p>
              ) : !prod ? (
                <div className="flex flex-col items-center py-10 text-center text-muted">
                  <ImageOff className="h-6 w-6" />
                  <p className="mt-2 text-sm">Este producto ya no está disponible.</p>
                </div>
              ) : (
                <PortalVariantMatrix productId={prod.id} name={prod.name} price={prod.price} image={prod.images[0] ?? null} variants={prod.variants} onAdded={close} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
