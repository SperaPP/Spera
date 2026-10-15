"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { formatMoney } from "@/lib/format";

type Item = { product_name: string; variant_label: string | null; quantity: number; unit_price: number; line_total: number };

export type ComprobanteData = {
  saleId: string;
  emisor: { razonSocial: string; nombreFantasia: string; cuit: string; domicilio: string; condicionIva: string; iibb: string; inicioActividades: string };
  receptor: { nombre: string; docLabel: string; doc: string; condicionIva: string; domicilio: string };
  letra: string;        // "A" | "B"
  codigo: string;       // "01" | "06"
  titulo: string;       // "FACTURA"
  ptoVta: number;
  nro: number;
  fecha: string;        // YYYY-MM-DD
  items: Item[];
  neto: number;
  iva: number;
  total: number;
  cae: string;
  caeVto: string;       // YYYY-MM-DD
  qrDataUrl: string;
  homologacion: boolean;
};

const fmtFecha = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export function ComprobanteArca({ c }: { c: ComprobanteData }) {
  const nroFmt = `${String(c.ptoVta).padStart(4, "0")}-${String(c.nro).padStart(8, "0")}`;
  const esA = c.letra === "A";

  return (
    <div>
      <style>{`
        @media print {
          .cmp-toolbar { display: none !important; }
          @page { size: A4; margin: 12mm; }
          body { background: #fff; }
          .cmp-paper { border: none !important; box-shadow: none !important; margin: 0 !important; max-width: 100% !important; }
        }
      `}</style>

      <div className="cmp-toolbar mb-5 flex items-center justify-between gap-3">
        <Link href={`/ventas/${c.saleId}`} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Volver a la venta
        </Link>
        <button onClick={() => window.print()} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover">
          <Printer className="h-4 w-4" /> Imprimir
        </button>
      </div>

      {c.homologacion && (
        <div className="cmp-toolbar mb-3 rounded-lg border border-warn bg-warn-bg px-3 py-2 text-sm text-ink">
          Comprobante de <strong>homologación</strong> (prueba, sin validez fiscal).
        </div>
      )}

      <div className="cmp-paper mx-auto max-w-[800px] rounded-lg border border-line bg-white p-8 text-black shadow-sm">
        {/* Cabecera: emisor | letra | datos del comprobante */}
        <div className="relative grid grid-cols-2 gap-4 border-b-2 border-black pb-3">
          <div className="pr-4">
            <div className="text-lg font-bold uppercase">{c.emisor.nombreFantasia}</div>
            <div className="text-sm">{c.emisor.razonSocial}</div>
            <div className="mt-1 text-xs leading-snug">
              <div>Domicilio: {c.emisor.domicilio}</div>
              <div>Condición frente al IVA: {c.emisor.condicionIva}</div>
            </div>
          </div>

          {/* Caja de la letra, centrada arriba */}
          <div className="absolute left-1/2 top-0 flex h-16 w-16 -translate-x-1/2 flex-col items-center justify-center border-2 border-black bg-white">
            <span className="text-3xl font-bold leading-none">{c.letra}</span>
            <span className="text-[9px]">COD. {c.codigo}</span>
          </div>

          <div className="pl-4 text-right">
            <div className="text-lg font-bold">{c.titulo}</div>
            <div className="text-sm font-medium tabular-nums">{nroFmt}</div>
            <div className="mt-1 text-xs leading-snug">
              <div>Fecha de emisión: {fmtFecha(c.fecha)}</div>
              <div>CUIT: {c.emisor.cuit}</div>
              {c.emisor.iibb && <div>Ingresos Brutos: {c.emisor.iibb}</div>}
              {c.emisor.inicioActividades && <div>Inicio de actividades: {c.emisor.inicioActividades}</div>}
            </div>
          </div>
        </div>

        {/* Receptor */}
        <div className="mt-3 border-b border-black/30 pb-2 text-xs leading-snug">
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
            <div><span className="text-black/60">{c.receptor.docLabel}:</span> {c.receptor.doc || "—"}</div>
            <div><span className="text-black/60">Cliente:</span> {c.receptor.nombre || "Consumidor Final"}</div>
            <div><span className="text-black/60">Condición frente al IVA:</span> {c.receptor.condicionIva}</div>
            {c.receptor.domicilio && <div><span className="text-black/60">Domicilio:</span> {c.receptor.domicilio}</div>}
          </div>
        </div>

        {/* Ítems */}
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="border-b border-black/40 text-left">
              <th className="py-1.5 font-semibold">Descripción</th>
              <th className="py-1.5 text-right font-semibold">Cant.</th>
              <th className="py-1.5 text-right font-semibold">P. Unitario</th>
              <th className="py-1.5 text-right font-semibold">Importe</th>
            </tr>
          </thead>
          <tbody>
            {c.items.map((it, i) => (
              <tr key={i} className="border-b border-black/10">
                <td className="py-1.5">{it.product_name}{it.variant_label ? <span className="text-black/60"> · {it.variant_label}</span> : null}</td>
                <td className="py-1.5 text-right tabular-nums">{it.quantity}</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(Number(it.unit_price))}</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(Number(it.line_total))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totales */}
        <div className="mt-3 flex justify-end">
          <div className="w-64 text-xs">
            {esA ? (
              <>
                <div className="flex justify-between py-0.5"><span>Importe Neto Gravado</span><span className="tabular-nums">{formatMoney(c.neto)}</span></div>
                <div className="flex justify-between py-0.5"><span>IVA 21%</span><span className="tabular-nums">{formatMoney(c.iva)}</span></div>
              </>
            ) : (
              <div className="flex justify-between py-0.5 text-black/60"><span>IVA contenido (Ley 27.743)</span><span className="tabular-nums">{formatMoney(c.iva)}</span></div>
            )}
            <div className="mt-1 flex justify-between border-t border-black/40 pt-1 text-sm font-bold"><span>Importe Total</span><span className="tabular-nums">{formatMoney(c.total)}</span></div>
          </div>
        </div>

        {/* CAE + QR */}
        <div className="mt-6 flex items-end justify-between gap-4 border-t border-black/30 pt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.qrDataUrl} alt="QR AFIP" className="h-32 w-32" />
          <div className="text-right text-xs">
            <div className="font-semibold">Comprobante Autorizado</div>
            <div className="mt-1">CAE N°: <span className="font-medium tabular-nums">{c.cae}</span></div>
            <div>Fecha de Vto. de CAE: <span className="tabular-nums">{fmtFecha(c.caeVto)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
