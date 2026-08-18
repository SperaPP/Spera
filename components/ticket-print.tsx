"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer, Gift, Receipt } from "lucide-react";
import { formatMoney, formatDateTime } from "@/lib/format";
import { Barcode } from "@/components/barcode";

type Item = { product_name: string; variant_label: string | null; quantity: number; unit_price: number; line_total: number };
type Payment = { name: string | null; amount: number };
export type TicketSale = {
  id: string;
  number: number;
  createdAt: string;
  orgName: string;
  storeName: string | null;
  subtotal: number;
  discount: number;
  total: number;
  items: Item[];
  payments: Payment[];
};

const ctl = "rounded-lg border border-line-strong bg-card px-3 py-1.5 text-sm text-ink";

export function TicketPrint({ sale, gift: giftInit }: { sale: TicketSale; gift: boolean }) {
  const [gift, setGift] = useState(giftInit);

  return (
    <div>
      <style>{`
        @media print {
          .tk-toolbar { display: none !important; }
          @page { size: 80mm auto; margin: 4mm; }
          body { background: #fff; }
          .tk-paper { border: none !important; box-shadow: none !important; margin: 0 !important; width: 72mm !important; }
        }
      `}</style>

      <div className="tk-toolbar mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/ventas/${sale.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Volver a la venta
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-line-strong text-sm">
            <button onClick={() => setGift(false)} className={`flex items-center gap-1.5 px-3 py-1.5 ${!gift ? "bg-accent text-accent-fg" : "text-ink hover:bg-canvas"}`}>
              <Receipt className="h-4 w-4" /> Ticket
            </button>
            <button onClick={() => setGift(true)} className={`flex items-center gap-1.5 px-3 py-1.5 ${gift ? "bg-accent text-accent-fg" : "text-ink hover:bg-canvas"}`}>
              <Gift className="h-4 w-4" /> Regalo
            </button>
          </div>
          <button onClick={() => window.print()} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover">
            <Printer className="h-4 w-4" /> Imprimir
          </button>
        </div>
      </div>

      {/* Papel del ticket (~72mm) */}
      <div className="tk-paper mx-auto w-[72mm] rounded-lg border border-line bg-white p-4 font-mono text-[11px] leading-tight text-black shadow-sm">
        <div className="text-center">
          <div className="text-sm font-bold uppercase tracking-wide">{sale.orgName}</div>
          {sale.storeName && <div>{sale.storeName}</div>}
          <div className="mt-0.5 text-[10px]">{formatDateTime(sale.createdAt)}</div>
        </div>

        <div className="my-2 border-t border-dashed border-black/40" />

        <div className="flex items-center justify-between font-bold">
          <span>VENTA</span>
          <span>#{sale.number}</span>
        </div>
        {gift && <div className="mt-0.5 text-center text-[10px] font-bold uppercase tracking-wide">· Ticket regalo ·</div>}

        <div className="my-2 border-t border-dashed border-black/40" />

        {/* Ítems */}
        <div className="space-y-1">
          {sale.items.map((it, i) => (
            <div key={i}>
              <div className="flex justify-between gap-2">
                <span className="truncate">{it.quantity}× {it.product_name}</span>
                {!gift && <span className="shrink-0 tabular-nums">{formatMoney(Number(it.line_total))}</span>}
              </div>
              {it.variant_label && <div className="text-[10px] text-black/60">{it.variant_label}</div>}
            </div>
          ))}
        </div>

        {!gift && (
          <>
            <div className="my-2 border-t border-dashed border-black/40" />
            {Number(sale.discount) > 0 && (
              <>
                <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatMoney(Number(sale.subtotal))}</span></div>
                <div className="flex justify-between"><span>Descuento</span><span className="tabular-nums">− {formatMoney(Number(sale.discount))}</span></div>
              </>
            )}
            <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span className="tabular-nums">{formatMoney(Number(sale.total))}</span></div>
            {sale.payments.length > 0 && (
              <div className="mt-1 space-y-0.5 text-[10px]">
                {sale.payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-black/70"><span>{p.name ?? "—"}</span><span className="tabular-nums">{formatMoney(Number(p.amount))}</span></div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="my-2 border-t border-dashed border-black/40" />

        {/* Código escaneable del N° de venta */}
        <div className="px-1">
          <Barcode value={String(sale.number)} heightMm={11} />
          <div className="mt-0.5 text-center text-[10px] tracking-widest">#{sale.number}</div>
        </div>

        <div className="mt-2 text-center text-[10px] leading-snug text-black/70">
          Cambios dentro de los 30 días presentando este ticket.<br />
          Se cambia por otra prenda en cualquier sucursal.
        </div>
      </div>
    </div>
  );
}
