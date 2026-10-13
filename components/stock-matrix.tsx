"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ajustarStock } from "@/app/(app)/stock/actions";

type Variant = { id: string; label: string; sku: string | null };
type Warehouse = { id: string; name: string };

const key = (variantId: string, warehouseId: string) => `${variantId}|${warehouseId}`;

export function StockMatrix({
  productId,
  variants,
  warehouses,
  stockMap,
  reservedMap = {},
  readOnly = false,
}: {
  productId: string;
  variants: Variant[];
  warehouses: Warehouse[];
  stockMap: Record<string, number>;
  reservedMap?: Record<string, number>;
  readOnly?: boolean;
}) {
  // Se edita el FÍSICO (lo que hay en el depósito). Al lado se muestra, solo lectura,
  // lo RESERVADO (comprometido por pedidos sin despachar) y el DISPONIBLE (físico − reservado).
  const init: Record<string, number> = {};
  for (const v of variants) for (const w of warehouses) {
    const k = key(v.id, w.id);
    init[k] = stockMap[k] ?? 0;
  }

  const [saved, setSaved] = useState<Record<string, number>>(init);
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const k in init) d[k] = String(init[k]);
    return d;
  });
  const [, start] = useTransition();

  function save(variantId: string, warehouseId: string) {
    const k = key(variantId, warehouseId);
    const n = parseInt(draft[k], 10);
    if (isNaN(n) || n < 0) {
      toast.error("Cantidad inválida");
      setDraft((d) => ({ ...d, [k]: String(saved[k]) }));
      return;
    }
    if (n === saved[k]) return;
    // El número editado ES el físico. El sistema valida que no quede por debajo de lo reservado.
    start(async () => {
      const r = await ajustarStock(warehouseId, variantId, n, productId);
      if (r.error) {
        toast.error(r.error);
        setDraft((d) => ({ ...d, [k]: String(saved[k]) }));
      } else {
        setSaved((s) => ({ ...s, [k]: n }));
        toast.success("Stock actualizado");
      }
    });
  }

  const rowTotal = (variantId: string) =>
    warehouses.reduce((a, w) => a + (parseInt(draft[key(variantId, w.id)], 10) || 0), 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
            <th className="px-4 py-3 font-medium">Variante</th>
            {warehouses.map((w) => (
              <th key={w.id} className="px-3 py-3 text-center font-medium">{w.name}<div className="text-[9px] normal-case tracking-normal text-faint">físico · res · disp</div></th>
            ))}
            <th className="px-4 py-3 text-right font-medium">Total físico</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.id} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5">
                <div className="font-medium text-ink">{v.label}</div>
                {v.sku && <div className="font-mono text-xs text-muted">{v.sku}</div>}
              </td>
              {warehouses.map((w) => {
                const k = key(v.id, w.id);
                const res = reservedMap[k] ?? 0;
                const disp = Math.max(0, (parseInt(draft[k], 10) || 0) - res);
                return (
                  <td key={w.id} className="px-3 py-2.5 text-center align-top">
                    <input
                      type="number"
                      min={0}
                      disabled={readOnly}
                      value={draft[k] ?? "0"}
                      onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                      onBlur={() => save(v.id, w.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      className="w-20 rounded-lg border border-line-strong bg-card px-2 py-1.5 text-center text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60"
                    />
                    <div className="mt-1 text-[10px] tabular-nums text-muted">
                      {res > 0 ? <>res <span className="font-medium text-warn">{res}</span> · disp <span className="font-medium text-ink">{disp}</span></> : <span className="text-faint">disp {disp}</span>}
                    </div>
                  </td>
                );
              })}
              <td className="px-4 py-2.5 text-right align-top font-medium tabular-nums text-ink">{rowTotal(v.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
