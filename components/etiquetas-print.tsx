"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Barcode } from "@/components/barcode";

type Variant = { id: string; sku: string | null; label: string | null };

// Tamaños comunes de la Brother QL-800 (ancho × alto en mm).
const SIZES = [
  { key: "40x29", label: "40 × 29 mm", w: 40, h: 29 },
  { key: "62x29", label: "62 × 29 mm (DK-1209)", w: 62, h: 29 },
  { key: "90x29", label: "90 × 29 mm (DK-1201)", w: 90, h: 29 },
  { key: "62x40", label: "62 × 40 mm", w: 62, h: 40 },
  { key: "62x100", label: "62 × 100 mm (DK-1202)", w: 62, h: 100 },
  { key: "50x30", label: "50 × 30 mm", w: 50, h: 30 },
  { key: "custom", label: "Personalizado…", w: 0, h: 0 },
];

const ctl = "rounded-lg border border-line-strong bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-accent";

export function EtiquetasPrint({ productName, variants }: { productName: string; variants: Variant[] }) {
  const printable = variants.filter((v) => v.sku);
  const [sizeKey, setSizeKey] = useState("40x29");
  const [customW, setCustomW] = useState("70");
  const [customH, setCustomH] = useState("45");
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(printable.map((v) => [v.id, "1"])));
  const [bulk, setBulk] = useState("");

  const preset = SIZES.find((s) => s.key === sizeKey)!;
  const w = sizeKey === "custom" ? Math.max(10, Number(customW) || 70) : preset.w;
  const h = sizeKey === "custom" ? Math.max(10, Number(customH) || 45) : preset.h;

  // Tamaños de fuente que escalan con la etiqueta (mm).
  const nameSize = Math.max(3, Math.min(w / 11, h / 5));
  const varSize = nameSize * 0.72;
  const skuSize = Math.max(2, nameSize * 0.45);

  const num = (id: string) => Math.max(0, Math.min(99, Number(qty[id]) || 0));
  const labels = printable.flatMap((v) => Array.from({ length: num(v.id) }, (_, i) => ({ ...v, key: `${v.id}-${i}` })));
  const total = labels.length;

  function aplicarTodas() {
    const val = String(Math.max(0, Number(bulk) || 0));
    setQty(Object.fromEntries(printable.map((v) => [v.id, val])));
  }

  return (
    <div>
      <style>{`
        @media print {
          .etq-toolbar, .etq-config { display: none !important; }
          @page { size: ${w}mm ${h}mm; margin: 0; }
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
            <select value={sizeKey} onChange={(e) => setSizeKey(e.target.value)} className={ctl}>
              {SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          {sizeKey === "custom" && (
            <div className="flex items-center gap-1 text-sm text-muted">
              <input type="number" min={10} value={customW} onChange={(e) => setCustomW(e.target.value)} className={`${ctl} w-16`} /> ×
              <input type="number" min={10} value={customH} onChange={(e) => setCustomH(e.target.value)} className={`${ctl} w-16`} /> mm
            </div>
          )}
          <button onClick={() => window.print()} disabled={total === 0} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
            <Printer className="h-4 w-4" /> Imprimir ({total})
          </button>
        </div>
      </div>

      <div className="etq-config mb-6 rounded-xl border border-line bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <span className="text-sm font-medium text-ink">Cantidad de etiquetas por variante</span>
          <div className="flex items-center gap-2">
            <input type="number" min={0} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="0" className={`${ctl} w-16`} />
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
              <input type="number" min={0} max={99} value={qty[v.id] ?? "0"} onChange={(e) => setQty((q) => ({ ...q, [v.id]: e.target.value }))} className={`${ctl} w-20 text-right`} />
            </div>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <p className="etq-config rounded-xl border border-dashed border-line-strong bg-card px-4 py-8 text-center text-sm text-muted">
          Poné una cantidad mayor a cero en las variantes que quieras etiquetar.
        </p>
      ) : (
        <div className="etq-grid flex flex-wrap gap-2">
          {labels.map((l) => (
            <div
              key={l.key}
              className="etq-label flex flex-col overflow-hidden rounded border border-neutral-300 bg-white text-neutral-900"
              style={{ width: `${w}mm`, height: `${h}mm`, padding: "1.5mm" }}
            >
              <div className="w-full overflow-hidden text-center font-bold leading-none" style={{ fontSize: `${nameSize}mm`, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", wordBreak: "break-word" }}>{productName}</div>
              {l.label && <div className="mt-[0.5mm] w-full truncate text-center font-semibold leading-none" style={{ fontSize: `${varSize}mm` }}>{l.label}</div>}
              <div className="mt-[1mm] min-h-0 w-full flex-1">
                <Barcode value={l.sku!} fill />
              </div>
              <div className="mt-[0.5mm] w-full text-center tracking-widest leading-none" style={{ fontSize: `${skuSize}mm` }}>{l.sku}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
