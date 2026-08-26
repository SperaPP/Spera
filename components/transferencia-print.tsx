"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Printer } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { armadoPrintCss } from "@/components/armado-print";

export type TransferItem = {
  name: string;
  label: string | null;
  sku: string | null;
  quantity: number;
  fila: number | null;
  estante: number | null;
  cubiculo: number | null;
};

export type TransferData = {
  id: string;
  createdAt: string;
  orgName: string;
  from: string | null;
  to: string | null;
  notes: string | null;
  items: TransferItem[];
};

function locStr(it: TransferItem): string {
  if (it.fila == null && it.estante == null && it.cubiculo == null) return "Sin ubicar";
  const p = (n: number | null) => (n == null ? "–" : String(n));
  return `${p(it.fila)} · ${p(it.estante)} · ${p(it.cubiculo)}`;
}

export function TransferenciaPrint({ t }: { t: TransferData }) {
  const units = t.items.reduce((a, i) => a + i.quantity, 0);
  return (
    <div>
      <style>{armadoPrintCss}</style>

      <div className="ar-toolbar mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/transferencias/${t.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Volver a la transferencia
        </Link>
        <button onClick={() => window.print()} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover">
          <Printer className="h-4 w-4" /> Imprimir
        </button>
      </div>

      <div className="ar-paper mx-auto max-w-[800px] rounded-lg border border-line bg-white p-8 text-black shadow-sm">
        <div className="flex items-start justify-between border-b-2 border-black pb-3">
          <div>
            <div className="text-lg font-bold uppercase tracking-wide">{t.orgName}</div>
            <div className="text-sm">Orden de transferencia · Depósito</div>
          </div>
          <div className="text-right text-xs">{formatDateTime(t.createdAt)}</div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-1 text-sm">
          <span className="flex items-center gap-2 text-base font-bold">{t.from ?? "—"} <ArrowRight className="h-4 w-4" /> {t.to ?? "—"}</span>
          <span><span className="text-black/50">Ítems:</span> <span className="font-medium">{t.items.length}</span></span>
          <span><span className="text-black/50">Unidades:</span> <span className="font-medium">{units}</span></span>
        </div>
        {t.notes && <div className="mt-1 text-sm text-black/60">{t.notes}</div>}

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
            {t.items.map((it, i) => (
              <tr key={i} className="ar-row border-b border-black/20">
                <td className="py-2.5 pr-2 text-center"><span className="inline-block h-4 w-4 border border-black/60 align-middle" /></td>
                <td className="py-2.5 pr-2 font-mono text-base font-bold tabular-nums">{locStr(it)}</td>
                <td className="py-2.5 pr-2 font-medium">{it.name}</td>
                <td className="py-2.5 pr-2">{it.label ?? "—"}</td>
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
    </div>
  );
}
