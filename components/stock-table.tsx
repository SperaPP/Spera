"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StockMatrix } from "@/components/stock-matrix";
import { cargarMatrizStock } from "@/app/(app)/stock/actions";

type Warehouse = { id: string; name: string };
type Row = { id: string; name: string; perWh: Record<string, number>; perWhRes?: Record<string, number>; total: number };
type Matrix = { variants: { id: string; label: string; sku: string | null }[]; stockMap: Record<string, number>; reservedMap: Record<string, number> };

export function StockTable({ rows, warehouses, canEdit }: { rows: Row[]; warehouses: Warehouse[]; canEdit: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, Matrix>>({});
  const [loading, setLoading] = useState(false);

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!cache[id]) {
      setLoading(true);
      const m = await cargarMatrizStock(id);
      setCache((p) => ({ ...p, [id]: m }));
      setLoading(false);
    }
  }

  const cols = warehouses.length + 3;

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
            <th className="px-4 py-3 font-medium">Producto</th>
            {warehouses.map((w) => <th key={w.id} className="px-3 py-3 text-right font-medium">{w.name}</th>)}
            <th className="px-4 py-3 text-right font-medium">Total</th>
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const open = openId === p.id;
            return (
              <Fragment key={p.id}>
                <tr className="cursor-pointer border-b border-line hover:bg-canvas" onClick={() => toggle(p.id)}>
                  <td className="px-4 py-3 font-medium text-ink">{p.name}</td>
                  {warehouses.map((w) => {
                    const qty = p.perWh[w.id] ?? 0;
                    const res = p.perWhRes?.[w.id] ?? 0;
                    const disp = qty - res;
                    return (
                      <td key={w.id} className="px-3 py-3 text-right tabular-nums">
                        <span className={qty > 0 ? "text-ink" : qty < 0 ? "text-danger" : "text-faint"}>{qty}</span>
                        {res > 0 && (
                          <span className="block text-[11px] font-medium text-warn" title={`${res} reservado(s) en pedidos/transferencias sin cerrar`}>
                            {disp > 0 ? `${disp} disp.` : "0 disp."}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right font-semibold tabular-nums"><span className={p.total > 0 ? "text-ink" : p.total < 0 ? "text-danger" : "text-faint"}>{p.total}</span></td>
                  <td className="px-3 py-3 text-right text-faint">{open ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}</td>
                </tr>
                {open && (
                  <tr className="border-b border-line bg-canvas/40">
                    <td colSpan={cols} className="p-3">
                      {!cache[p.id] ? (
                        <p className="px-2 py-4 text-center text-sm text-muted">{loading ? "Cargando…" : "—"}</p>
                      ) : (
                        <>
                          <p className="mb-2 px-1 text-xs text-muted">{canEdit ? "Editá la existencia por variante y depósito. Se registra como ajuste." : "Solo lectura (no tenés permiso de edición de stock)."}</p>
                          <StockMatrix productId={p.id} variants={cache[p.id].variants} warehouses={warehouses} stockMap={cache[p.id].stockMap} reservedMap={cache[p.id].reservedMap} readOnly={!canEdit} />
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
