"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ShoppingCart, ImageOff } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/components/portal-cart";
import { sizeCmp } from "@/lib/sizes";
import { normColor } from "@/lib/colors";

type Variant = { id: string; label: string | null; size: string | null; color: string | null; stock: number };

export function PortalVariantMatrix({
  productId, name, price, image, imagesByColor = [], variants, onAdded, showPreview = true,
}: {
  productId: string; name: string; price: number; image: string | null;
  imagesByColor?: { color: string; url: string }[]; variants: Variant[]; onAdded?: () => void; showPreview?: boolean;
}) {
  const { add } = useCart();
  const [qty, setQty] = useState<Record<string, number>>({});

  // Mapa color→foto (normalizado) y función con fallback a la portada.
  const colorImg = useMemo(() => new Map(imagesByColor.map((i) => [i.color, i.url])), [imagesByColor]);
  const imageForColor = (color: string | null) => colorImg.get(normColor(color)) ?? image;
  const hasColorPhotos = colorImg.size > 0;

  const { rows, cols, byCell } = useMemo(() => {
    const sizes = [...new Set(variants.map((v) => v.size).filter(Boolean) as string[])].sort(sizeCmp);
    const colors = [...new Set(variants.map((v) => v.color).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "es"));
    const byCell = new Map<string, Variant>();
    for (const v of variants) byCell.set(`${v.color ?? ""}|${v.size ?? ""}`, v);
    return { rows: colors.length ? colors : [null], cols: sizes.length ? sizes : [null], byCell };
  }, [variants]);

  // Color mostrado en el panel de foto: el primero con foto propia, si no el primero.
  const [selColor, setSelColor] = useState<string | null>(() => {
    const colors = rows.filter((r): r is string => r !== null);
    return colors.find((c) => colorImg.has(normColor(c))) ?? colors[0] ?? null;
  });
  const preview = imageForColor(selColor);

  const cellVariant = (row: string | null, col: string | null) => byCell.get(`${row ?? ""}|${col ?? ""}`);
  const set = (id: string, n: number, max: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, Math.floor(n) || 0)) }));

  const totalUnidades = Object.values(qty).reduce((a, n) => a + n, 0);
  const totalPrecio = totalUnidades * price;

  function agregar() {
    let added = 0;
    for (const v of variants) {
      const n = qty[v.id] ?? 0;
      if (n > 0) { add({ variantId: v.id, productId, name, label: v.label, price, qty: n, image: imageForColor(v.color), maxStock: v.stock }); added += n; }
    }
    if (added === 0) return toast.error("Cargá alguna cantidad.");
    setQty({});
    toast.success(`${added} unidad(es) agregada(s) al pedido.`);
    onAdded?.();
  }

  const soloUnaCelda = rows.length === 1 && cols.length === 1;
  const panel = showPreview && (preview || hasColorPhotos);

  return (
    <div className={panel ? "grid gap-4 sm:grid-cols-[200px_1fr]" : ""}>
      {/* Panel de foto (cambia según el color elegido) */}
      {panel && (
        <div className="space-y-2">
          <div className="aspect-square w-full overflow-hidden rounded-xl border border-line bg-canvas">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt={name} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-faint"><ImageOff className="h-8 w-8" /></span>
            )}
          </div>
          {/* Miniaturas por color */}
          {hasColorPhotos && rows.filter((r): r is string => r !== null).length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {rows.filter((r): r is string => r !== null).map((c) => {
                const url = imageForColor(c);
                const activo = normColor(c) === normColor(selColor);
                return (
                  <button
                    key={c} type="button" onClick={() => setSelColor(c)} title={c}
                    className={`h-10 w-10 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${activo ? "border-accent" : "border-transparent hover:border-line-strong"}`}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={c} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-canvas text-[9px] text-faint">{c.slice(0, 3)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Matriz talle × color */}
      <div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-canvas">
                <th className="sticky left-0 z-10 bg-canvas px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-faint">
                  {rows[0] !== null ? "Color" : ""}
                </th>
                {cols.map((c) => (
                  <th key={c ?? "u"} className="px-2 py-2 text-center text-xs font-semibold text-ink">{c ?? "Cantidad"}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const activo = row !== null && normColor(row) === normColor(selColor);
                return (
                  <tr key={row ?? "u"} className={`border-t border-line ${activo ? "bg-accent-soft/40" : ""}`}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-2 py-1.5">
                      {row !== null ? (
                        <button type="button" onClick={() => setSelColor(row)} className="flex items-center gap-2 text-left text-sm font-medium text-ink">
                          {imageForColor(row) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={imageForColor(row)!} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                          ) : null}
                          <span>{row}</span>
                        </button>
                      ) : (
                        <span className="px-1 text-sm font-medium text-ink">{soloUnaCelda ? "Cantidad" : ""}</span>
                      )}
                    </td>
                    {cols.map((col) => {
                      const v = cellVariant(row, col);
                      if (!v) return <td key={col ?? "u"} className="px-2 py-2 text-center text-faint">–</td>;
                      const n = qty[v.id] ?? 0;
                      return (
                        <td key={col ?? "u"} className="px-1.5 py-1.5 text-center">
                          <input
                            type="number" min={0} max={v.stock} inputMode="numeric"
                            value={n || ""} placeholder="0"
                            onFocus={() => row !== null && setSelColor(row)}
                            onChange={(e) => set(v.id, Number(e.target.value), v.stock)}
                            className={`w-14 rounded-md border bg-canvas px-1 py-1.5 text-center text-sm tabular-nums outline-none focus:border-accent ${n > 0 ? "border-accent text-ink" : "border-line-strong text-ink"}`}
                          />
                          <div className={`mt-0.5 text-[10px] tabular-nums ${v.stock <= 5 ? "text-warn" : "text-faint"}`}>{v.stock} disp.</div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-3">
          <div className="text-sm">
            <span className="text-muted">Seleccionado: </span>
            <span className="font-semibold text-ink">{totalUnidades} u.</span>
            {totalUnidades > 0 && <span className="ml-2 font-semibold tabular-nums text-accent">{formatMoney(totalPrecio)}</span>}
          </div>
          <button onClick={agregar} disabled={totalUnidades === 0} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50">
            <ShoppingCart className="h-4 w-4" /> Agregar al pedido
          </button>
        </div>
      </div>
    </div>
  );
}
