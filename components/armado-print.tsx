"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { formatDateTime } from "@/lib/format";

export type ArmadoItem = {
  productName: string;
  variantLabel: string | null;
  sku: string | null;
  quantity: number;
  fila: number | null;
  estante: number | null;
  cubiculo: number | null;
};

export type ArmadoSale = {
  id: string;
  number: number;
  createdAt: string;
  orgName: string;
  storeName: string | null;
  customerName: string | null;
  items: ArmadoItem[];
};

function locStr(it: ArmadoItem): string {
  if (it.fila == null && it.estante == null && it.cubiculo == null) return "Sin ubicar";
  const p = (n: number | null) => (n == null ? "–" : String(n));
  return `${p(it.fila)} · ${p(it.estante)} · ${p(it.cubiculo)}`;
}

export const armadoPrintCss = `
  @media print {
    .ar-toolbar { display: none !important; }
    @page { size: A4 portrait; margin: 12mm; }
    body { background: #fff; }
    .ar-paper { border: none !important; box-shadow: none !important; margin: 0 !important; max-width: none !important; padding: 0 !important; }
    .ar-row { break-inside: avoid; }
    .ar-break { break-after: page; }
  }
`;

export function ArmadoPrint({ sale }: { sale: ArmadoSale }) {
  return (
    <div>
      <style>{armadoPrintCss}</style>

      <div className="ar-toolbar mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/ventas/${sale.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Volver a la venta
        </Link>
        <button onClick={() => window.print()} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover">
          <Printer className="h-4 w-4" /> Imprimir
        </button>
      </div>

      <ArmadoSheet sale={sale} />
    </div>
  );
}

export function ArmadoSheet({ sale }: { sale: ArmadoSale }) {
  const units = sale.items.reduce((a, i) => a + i.quantity, 0);
  return (
      <div className="ar-paper mx-auto max-w-[800px] rounded-lg border border-line bg-white p-8 text-black shadow-sm">
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <div className="text-lg font-bold uppercase tracking-wide">{sale.orgName}</div>
            <div className="text-sm">Orden de armado · Depósito</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">Pedido #{sale.number}</div>
            <div className="text-xs">{formatDateTime(sale.createdAt)}</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
          {sale.customerName && <span><span className="text-black/50">Cliente:</span> <span className="font-medium">{sale.customerName}</span></span>}
          {sale.storeName && <span><span className="text-black/50">Local:</span> <span className="font-medium">{sale.storeName}</span></span>}
          <span><span className="text-black/50">Ítems:</span> <span className="font-medium">{sale.items.length}</span></span>
          <span><span className="text-black/50">Unidades:</span> <span className="font-medium">{units}</span></span>
        </div>

        <table className="mt-5 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="w-10 py-2 pr-2 text-center font-semibold">✓</th>
              <th className="w-28 py-2 pr-2 font-semibold">Ubicación<div className="text-[10px] font-normal text-black/50">Fila · Est · Cub</div></th>
              <th className="py-2 pr-2 font-semibold">Producto</th>
              <th className="w-32 py-2 pr-2 font-semibold">Variante</th>
              <th className="w-28 py-2 pr-2 font-semibold">SKU</th>
              <th className="w-14 py-2 text-center font-semibold">Cant.</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((it, i) => (
              <tr key={i} className="ar-row border-b border-black/20">
                <td className="py-2.5 pr-2 text-center"><span className="inline-block h-4 w-4 border border-black/60 align-middle" /></td>
                <td className="py-2.5 pr-2 font-mono text-base font-bold tabular-nums">{locStr(it)}</td>
                <td className="py-2.5 pr-2 font-medium">{it.productName}</td>
                <td className="py-2.5 pr-2">{it.variantLabel ?? "—"}</td>
                <td className="py-2.5 pr-2 font-mono text-xs text-black/70">{it.sku ?? "—"}</td>
                <td className="py-2.5 text-center text-lg font-bold tabular-nums">{it.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 flex justify-between text-xs text-black/50">
          <span>Ordenado por ubicación (fila → estante → cubículo) para el recorrido de armado.</span>
          <span>Armó: ____________________</span>
        </div>
      </div>
  );
}
