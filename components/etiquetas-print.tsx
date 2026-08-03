"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Barcode } from "@/components/barcode";

type Variant = { id: string; sku: string | null; label: string | null };

// Tamaños de etiqueta comunes de la Brother QL-800 (ancho × alto en mm).
const SIZES = [
  { key: "62x29", label: "62 × 29 mm (DK-1209)", w: 62, h: 29 },
  { key: "90x29", label: "90 × 29 mm (DK-1201)", w: 90, h: 29 },
  { key: "62x40", label: "62 × 40 mm", w: 62, h: 40 },
  { key: "62x100", label: "62 × 100 mm (DK-1202)", w: 62, h: 100 },
  { key: "50x30", label: "50 × 30 mm", w: 50, h: 30 },
  { key: "29x62", label: "29 × 62 mm (vertical)", w: 29, h: 62 },
];

const input = "rounded-lg border border-line-strong bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";

export function EtiquetasPrint({ productName, variants }: { productName: string; variants: Variant[] }) {
  const printable = variants.filter((v) => v.sku);
  const [sizeKey, setSizeKey] = useState("62x29");
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(printable.map((v) => [v.id, "1"])));
  const [bulk, setBulk] = useState("");

  const size = SIZES.find((s) => s.key === sizeKey)!;
  const nameSize = Math.max(2.6, Math.min(4.2, size.w / 16));

  const num = (id: string) => Math.max(0, Math.min(99, Number(qty[id]) || 0));
  const labels = printable.flatMap((v) => Array.from({ length: num(v.id) }, (_, i) => ({ ...v, key: `${v.id}-${i}` })));
  const totalLabels = labels.length;

  function aplicarTodas() {
    const val = String(Math.max(0, Number(bulk) || 0));
    setQty(Object.fromEntries(printable.map((v) => [v.id, val])));
  }

  return (
    <div>
      <style>{`
        @media print {
          .etq-toolbar, .etq-config { display: none !important; }
          @page { size: ${size.w}mm ${size.h}mm; margin: 0; }
          body { background: #fff; }
          .etq-grid { display: block !important; gap: 0 !important; }
          .etq-label { border: none !important; margin: 0 !important; }
          .etq-label:not(:last-child) { break-after: page; }
        }
      `}</style>

      <div className="etq-toolbar mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/productos" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Volver
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            Etiqueta
            <select value={sizeKey} onChange={(e) => setSizeKey(e.target.value)} className={input}>
              {SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <button
            onClick={() => window.print()}
            disabled={totalLabels === 0}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            <Printer className="h-4 w-4" /> Imprimir ({totalLabels})
          </button>
        </div>
      </div>

      {/* Cantidad por variante */}
      <div className="etq-config mb-6 rounded-xl border border-line bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <span className="text-sm font-medium text-ink">Cantidad de etiquetas por variante</span>
          <div className="flex items-center gap-2">
            <input type="number" min={0} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="0" className={`${input} w-16`} />
            <button onClick={aplicarTodas} className="rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-canvas">Aplicar a todas</button>
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {printable.map((v) => (
            <div key={v.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <span className="text-sm text-ink">{v.label ?? "Única"}</span>
                <span className="ml-2 font-mono text-xs text-muted">{v.sku}</span>
              </div>
              <input
                type="number" min={0} max={99} value={qty[v.id] ?? "0"}
                onChange={(e) => setQty((q) => ({ ...q, [v.id]: e.target.value }))}
                className={`${input} w-20 text-right`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Etiquetas a imprimir */}
      {totalLabels === 0 ? (
        <p className="etq-config rounded-xl border border-dashed border-line-strong bg-card px-4 py-8 text-center text-sm text-muted">
          Poné una cantidad mayor a cero en las variantes que quieras etiquetar.
        </p>
      ) : (
        <div className="etq-grid flex flex-wrap gap-2">
          {labels.map((l) => (
            <div
              key={l.key}
              className="etq-label flex flex-col items-center justify-center overflow-hidden rounded border border-neutral-300 bg-white text-neutral-900"
              style={{ width: `${size.w}mm`, height: `${size.h}mm`, padding: "1.5mm" }}
            >
              <div className="w-full text-center font-bold leading-tight" style={{ fontSize: `${nameSize}mm` }}>{productName}</div>
              {l.label && <div className="w-full text-center font-semibold leading-tight" style={{ fontSize: `${nameSize * 0.8}mm` }}>{l.label}</div>}
              <div className="mt-1 w-full"><Barcode value={l.sku!} heightMm={Math.max(8, size.h * 0.32)} /></div>
              <div className="text-center tracking-widest" style={{ fontSize: "2mm" }}>{l.sku}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
