"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ShoppingCart } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/components/portal-cart";

type Variant = { id: string; label: string | null; size: string | null; color: string | null; stock: number };

const SIZE_RANK: Record<string, number> = { U: 0, "ÚNICO": 0, UNICO: 0, UNICA: 0, XS: 1, S: 2, M: 3, L: 4, XL: 5, XXL: 6, XXXL: 7, XXXXL: 8 };
function sizeCmp(a: string, b: string) {
  const na = Number(a), nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  const ra = SIZE_RANK[a.toUpperCase()], rb = SIZE_RANK[b.toUpperCase()];
  if (ra != null && rb != null) return ra - rb;
  if (ra != null) return -1;
  if (rb != null) return 1;
  return a.localeCompare(b, "es");
}

export function PortalVariantMatrix({
  productId, name, price, image, variants,
}: { productId: string; name: string; price: number; image: string | null; variants: Variant[] }) {
  const { add } = useCart();
  const [qty, setQty] = useState<Record<string, number>>({});

  const { rows, cols, byCell } = useMemo(() => {
    const sizes = [...new Set(variants.map((v) => v.size).filter(Boolean) as string[])].sort(sizeCmp);
    const colors = [...new Set(variants.map((v) => v.color).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "es"));
    const byCell = new Map<string, Variant>();
    for (const v of variants) byCell.set(`${v.color ?? ""}|${v.size ?? ""}`, v);
    return {
      rows: colors.length ? colors : [null],
      cols: sizes.length ? sizes : [null],
      byCell,
    };
  }, [variants]);

  const cellVariant = (row: string | null, col: string | null) => byCell.get(`${row ?? ""}|${col ?? ""}`);

  const set = (id: string, n: number, max: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, Math.floor(n) || 0)) }));

  const totalUnidades = Object.values(qty).reduce((a, n) => a + n, 0);
  const totalPrecio = totalUnidades * price;

  function agregar() {
    let added = 0;
    for (const v of variants) {
      const n = qty[v.id] ?? 0;
      if (n > 0) { add({ variantId: v.id, productId, name, label: v.label, price, qty: n, image, maxStock: v.stock }); added += n; }
    }
    if (added === 0) return toast.error("Cargá alguna cantidad.");
    setQty({});
    toast.success(`${added} unidad(es) agregada(s) al pedido.`);
  }

  const soloUnaCelda = rows.length === 1 && cols.length === 1;

  return (
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
            {rows.map((row) => (
              <tr key={row ?? "u"} className="border-t border-line">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2 text-sm font-medium text-ink">{row ?? (soloUnaCelda ? "Cantidad" : "")}</td>
                {cols.map((col) => {
                  const v = cellVariant(row, col);
                  if (!v) return <td key={col ?? "u"} className="px-2 py-2 text-center text-faint">–</td>;
                  const n = qty[v.id] ?? 0;
                  return (
                    <td key={col ?? "u"} className="px-1.5 py-1.5 text-center">
                      <input
                        type="number" min={0} max={v.stock} inputMode="numeric"
                        value={n || ""} placeholder="0"
                        onChange={(e) => set(v.id, Number(e.target.value), v.stock)}
                        className={`w-14 rounded-md border bg-canvas px-1 py-1.5 text-center text-sm tabular-nums outline-none focus:border-accent ${n > 0 ? "border-accent text-ink" : "border-line-strong text-ink"}`}
                      />
                      <div className={`mt-0.5 text-[10px] tabular-nums ${v.stock <= 5 ? "text-warn" : "text-faint"}`}>{v.stock} disp.</div>
                    </td>
                  );
                })}
              </tr>
            ))}
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
  );
}
