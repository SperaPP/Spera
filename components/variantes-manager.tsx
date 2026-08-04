"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Printer, Plus, X, Trash2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { agregarVariante, toggleVariante, borrarVariante } from "@/app/(app)/productos/actions";

type Ref = { id: string; name: string };
type Variant = {
  id: string;
  size: string | null;
  color: string | null;
  sku: string | null;
  barcode: string | null;
  active: boolean;
  stock: number;
};

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function VariantesManager({
  productId,
  variationType,
  warehouseId,
  warehouseName,
  sizes,
  colors,
  variants,
  canEdit,
}: {
  productId: string;
  variationType: string;
  warehouseId: string | null;
  warehouseName: string;
  sizes: Ref[];
  colors: Ref[];
  variants: Variant[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [nSize, setNSize] = useState("");
  const [nColor, setNColor] = useState("");
  const [nSku, setNSku] = useState("");
  const [nStock, setNStock] = useState("");

  const usesSize = variationType === "size" || variationType === "size_color";
  const usesColor = variationType === "color" || variationType === "size_color";
  const canAdd = canEdit && variationType !== "none";

  function add() {
    if (usesSize && !nSize.trim()) return toast.error("Elegí un talle.");
    if (usesColor && !nColor.trim()) return toast.error("Elegí un color.");
    startTransition(async () => {
      const res = await agregarVariante({
        productId,
        size: usesSize ? nSize.trim() : undefined,
        color: usesColor ? nColor.trim() : undefined,
        sku: nSku.trim() || undefined,
        stock: Number(nStock) || 0,
        warehouseId,
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success("Variante agregada.");
      setNSize(""); setNColor(""); setNSku(""); setNStock(""); setAdding(false);
      router.refresh();
    });
  }

  function toggle(v: Variant) {
    setBusyId(v.id);
    startTransition(async () => {
      const res = await toggleVariante(v.id, !v.active, productId);
      setBusyId(null);
      if (res.error) { toast.error(res.error); return; }
      toast.success(v.active ? "Variante desactivada." : "Variante activada.");
      router.refresh();
    });
  }

  function borrar(v: Variant) {
    const etq = [v.size, v.color].filter(Boolean).join(" / ") || "única";
    if (!confirm(`¿Borrar la variante ${etq}? Sólo se puede si nunca tuvo movimientos.`)) return;
    setBusyId(v.id);
    startTransition(async () => {
      const res = await borrarVariante(v.id, productId);
      setBusyId(null);
      if (res.error) { toast.error(res.error); return; }
      toast.success("Variante borrada.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-sm font-medium text-ink">Variantes</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">{variants.length} en total</span>
          {canAdd && (
            <button
              type="button"
              onClick={() => setAdding((s) => !s)}
              className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar variante
            </button>
          )}
          <Link href={`/etiquetas/${productId}`} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas">
            <Printer className="h-3.5 w-3.5" /> Imprimir etiquetas
          </Link>
        </div>
      </div>

      {adding && canAdd && (
        <div className="border-b border-line bg-canvas/60 px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            {usesSize && (
              <div className="w-32">
                <label className="mb-1 block text-xs font-medium text-muted">Talle</label>
                <input list="sizes-dl" value={nSize} onChange={(e) => setNSize(e.target.value)} className={`${input} py-1.5`} placeholder="Talle" />
                <datalist id="sizes-dl">{sizes.map((s) => <option key={s.id} value={s.name} />)}</datalist>
              </div>
            )}
            {usesColor && (
              <div className="w-40">
                <label className="mb-1 block text-xs font-medium text-muted">Color</label>
                <input list="colors-dl" value={nColor} onChange={(e) => setNColor(e.target.value)} className={`${input} py-1.5`} placeholder="Color" />
                <datalist id="colors-dl">{colors.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              </div>
            )}
            <div className="w-40">
              <label className="mb-1 block text-xs font-medium text-muted">SKU (opcional)</label>
              <input value={nSku} onChange={(e) => setNSku(e.target.value)} className={`${input} py-1.5`} placeholder="Automático" />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-muted">Stock inicial</label>
              <input type="number" min={0} value={nStock} onChange={(e) => setNStock(e.target.value)} className={`${input} py-1.5`} placeholder="0" />
            </div>
            <button type="button" onClick={add} disabled={pending} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
              {pending ? "Agregando…" : "Agregar"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-line-strong p-2 text-muted hover:bg-canvas">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">El stock inicial ingresa en <span className="font-medium text-ink">{warehouseName}</span>.</p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
              <th className="px-5 py-2.5 font-medium">Variante</th>
              <th className="px-5 py-2.5 font-medium">SKU</th>
              <th className="px-5 py-2.5 font-medium">Código de barras</th>
              <th className="px-5 py-2.5 text-right font-medium">Stock</th>
              <th className="px-5 py-2.5 font-medium">Estado</th>
              {canEdit && <th className="px-5 py-2.5 text-right font-medium">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => {
              const busy = busyId === v.id;
              return (
                <tr key={v.id} className={cn("border-b border-line last:border-0", !v.active && "opacity-60")}>
                  <td className="px-5 py-2.5">
                    {v.size || v.color ? (
                      <div className="flex flex-wrap gap-1">
                        {v.size && <span className="rounded-md bg-canvas px-2 py-0.5 text-xs font-medium text-ink">{v.size}</span>}
                        {v.color && <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{v.color}</span>}
                      </div>
                    ) : (
                      <span className="text-muted">Única</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-xs text-ink">{v.sku ?? "—"}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-muted">{v.barcode ?? "—"}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-ink">{v.stock}</td>
                  <td className="px-5 py-2.5">
                    {v.active ? (
                      <span className="rounded-full bg-ok-bg px-2 py-0.5 text-xs font-medium text-ok">Activa</span>
                    ) : (
                      <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-muted">Inactiva</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-5 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => toggle(v)} disabled={busy} className="rounded-lg border border-line-strong px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-50">
                          {v.active ? "Desactivar" : "Activar"}
                        </button>
                        <button type="button" onClick={() => borrar(v)} disabled={busy} title="Borrar (solo si nunca se usó)" className="rounded-lg border border-line-strong p-1.5 text-danger transition-colors hover:bg-danger-bg disabled:opacity-50">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
