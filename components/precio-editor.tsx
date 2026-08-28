"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tag } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { setPrecioMayorista, setPrecioPublico, setPromoPrice } from "@/app/(app)/productos/actions";
import type { ActionState } from "@/lib/auth";

export function PrecioEditor({
  productId,
  mayoristaListId,
  publicoListId,
  mayorista,
  mayoristaPromo,
  publico,
  publicoPromo,
  canEdit,
}: {
  productId: string;
  mayoristaListId: string | null;
  publicoListId: string | null;
  mayorista: number | null;
  mayoristaPromo: number | null;
  publico: number | null;
  publicoPromo: number | null;
  canEdit: boolean;
}) {
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      <ListaPrecio
        name="Mayorista (base)" accent listId={mayoristaListId}
        price={mayorista} promo={mayoristaPromo} canEdit={canEdit} productId={productId}
        savePrice={(n) => setPrecioMayorista(productId, n)}
      />
      <ListaPrecio
        name="Publico" listId={publicoListId}
        price={publico} promo={publicoPromo} canEdit={canEdit} productId={productId}
        savePrice={(n) => setPrecioPublico(productId, n)}
      />
    </div>
  );
}

function ListaPrecio({
  name, accent, listId, price, promo, canEdit, productId, savePrice,
}: {
  name: string; accent?: boolean; listId: string | null;
  price: number | null; promo: number | null; canEdit: boolean; productId: string;
  savePrice: (n: number) => Promise<ActionState>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editPrice, setEditPrice] = useState(false);
  const [editPromo, setEditPromo] = useState(false);
  const [valPrice, setValPrice] = useState(price != null ? String(price) : "");
  const [valPromo, setValPromo] = useState(promo != null ? String(promo) : "");

  const promoActive = price != null && promo != null && promo < price;

  function doPrice() {
    const n = Number(valPrice);
    if (!isFinite(n) || n < 0) return toast.error("Precio inválido.");
    start(async () => {
      const r = await savePrice(n);
      if (r.error) { toast.error(r.error); return; }
      toast.success(`Precio ${name} actualizado.`);
      setEditPrice(false); router.refresh();
    });
  }

  function doPromo(clear: boolean) {
    if (!listId) return toast.error("No se encontró la lista.");
    const n = clear ? null : Number(valPromo);
    if (n != null && (!isFinite(n) || n < 0)) return toast.error("Promo inválida.");
    if (n != null && price != null && n >= price) return toast.error("La promo tiene que ser menor al precio de lista.");
    start(async () => {
      const r = await setPromoPrice(productId, listId, n);
      if (r.error) { toast.error(r.error); return; }
      toast.success(clear ? `Promo de ${name} quitada.` : `Promo de ${name} activada.`);
      setEditPromo(false); router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-line bg-canvas/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-muted">{name}:</span>
          {promoActive ? (
            <span className="flex items-baseline gap-2">
              <span className="text-sm text-faint line-through">{formatMoney(price!)}</span>
              <span className="text-base font-semibold text-danger">{formatMoney(promo!)}</span>
              <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">Promo</span>
            </span>
          ) : (
            <span className={accent ? "text-base font-semibold text-accent" : "text-base font-medium text-ink"}>
              {price != null ? formatMoney(price) : "—"}
            </span>
          )}
        </div>
        {canEdit && !editPrice && !editPromo && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { setValPrice(price != null ? String(price) : ""); setEditPrice(true); }} className="rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-canvas">
              {price != null ? "Editar" : "Cargar"}
            </button>
            {price != null && (
              <button type="button" onClick={() => { setValPromo(promo != null ? String(promo) : ""); setEditPromo(true); }} className="flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-canvas">
                <Tag className="h-3 w-3" /> {promo != null ? "Promo" : "Poner promo"}
              </button>
            )}
          </div>
        )}
      </div>

      {editPrice && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Precio {name}</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">$</span>
              <input autoFocus type="number" min={0} value={valPrice} onChange={(e) => setValPrice(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doPrice(); if (e.key === "Escape") setEditPrice(false); }}
                className="w-36 rounded-lg border border-line-strong bg-card px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
            </div>
          </div>
          <button type="button" onClick={doPrice} disabled={pending} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">{pending ? "Guardando…" : "Guardar"}</button>
          <button type="button" onClick={() => setEditPrice(false)} className="rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
        </div>
      )}

      {editPromo && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Precio promocional {name}</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">$</span>
              <input autoFocus type="number" min={0} value={valPromo} onChange={(e) => setValPromo(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doPromo(false); if (e.key === "Escape") setEditPromo(false); }}
                className="w-36 rounded-lg border border-line-strong bg-card px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
            </div>
          </div>
          <button type="button" onClick={() => doPromo(false)} disabled={pending} className="rounded-lg bg-danger px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">{pending ? "Guardando…" : "Activar promo"}</button>
          {promo != null && <button type="button" onClick={() => doPromo(true)} disabled={pending} className="rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas">Quitar promo</button>}
          <button type="button" onClick={() => setEditPromo(false)} className="rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
          <p className="w-full text-xs text-muted">Se muestra el precio de lista tachado y se cobra la promo. Tiene que ser menor al precio de lista.</p>
        </div>
      )}
    </div>
  );
}
