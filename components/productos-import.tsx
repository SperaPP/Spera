"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Download, Upload, Boxes, MapPin } from "lucide-react";
import { exportarStock, importarStock, exportarUbicaciones, importarUbicaciones } from "@/app/(app)/productos/import-actions";

type Warehouse = { id: string; name: string };

export function ProductosImport({ warehouses }: { warehouses: Warehouse[] }) {
  const [whId, setWhId] = useState(warehouses[0]?.id ?? "");
  const [pending, start] = useTransition();
  const stockInput = useRef<HTMLInputElement>(null);
  const ubicInput = useRef<HTMLInputElement>(null);

  const whName = warehouses.find((w) => w.id === whId)?.name ?? "deposito";

  function expStock() {
    start(async () => {
      const r = await exportarStock(whId);
      if (r.error || !r.rows) { toast.error(r.error ?? "No se pudo exportar"); return; }
      const ws = XLSX.utils.json_to_sheet(r.rows, { header: ["sku", "producto", "variante", "cantidad"] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Stock");
      XLSX.writeFile(wb, `stock-${whName.toLowerCase().replace(/\s+/g, "-")}.xlsx`);
      toast.success(`Exportadas ${r.rows.length} variantes.`);
    });
  }
  function impStock(file: File) {
    start(async () => {
      let rows: { sku: string; cantidad: unknown }[];
      try {
        const wb = XLSX.read(await file.arrayBuffer());
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
        rows = json.map((r) => ({ sku: String(r.sku ?? "").trim(), cantidad: r.cantidad }))
          .filter((r) => r.sku && r.cantidad !== "" && r.cantidad != null && isFinite(Number(r.cantidad)));
      } catch { toast.error("No se pudo leer el archivo."); return; }
      if (rows.length === 0) { toast.error("Sin filas válidas (columnas sku y cantidad)."); return; }
      const r = await importarStock(whId, rows);
      if (r.error) toast.error(r.error); else toast.success(`Stock actualizado: ${r.count} variantes en ${whName}.`);
    });
  }

  function expUbic() {
    start(async () => {
      const r = await exportarUbicaciones();
      if (r.error || !r.rows) { toast.error(r.error ?? "No se pudo exportar"); return; }
      const ws = XLSX.utils.json_to_sheet(r.rows, { header: ["sku", "producto", "variante", "fila", "estante", "cubiculo"] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Ubicaciones");
      XLSX.writeFile(wb, "ubicaciones.xlsx");
      toast.success(`Exportadas ${r.rows.length} variantes.`);
    });
  }
  function impUbic(file: File) {
    start(async () => {
      let rows: Record<string, unknown>[];
      try {
        const wb = XLSX.read(await file.arrayBuffer());
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
        rows = json.map((r) => ({ sku: String(r.sku ?? "").trim(), fila: r.fila ?? "", estante: r.estante ?? "", cubiculo: r.cubiculo ?? "" })).filter((r) => r.sku);
      } catch { toast.error("No se pudo leer el archivo."); return; }
      if (rows.length === 0) { toast.error("Sin filas válidas (columna sku)."); return; }
      const r = await importarUbicaciones(rows);
      if (r.error) toast.error(r.error); else toast.success(`Ubicaciones actualizadas: ${r.count} variantes.`);
    });
  }

  const btn = "flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-60";
  const btnPrimary = "flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60";

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-card p-5">
        <div className="mb-1 flex items-center gap-2"><Boxes className="h-4 w-4 text-muted" /><h2 className="font-medium text-ink">Stock por depósito</h2></div>
        <p className="mb-3 text-sm text-muted">Exportá la plantilla, completá la columna <span className="font-medium text-ink">cantidad</span> y volvé a importar. La cantidad reemplaza la existencia actual (matchea por SKU). En blanco = no toca.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={whId} onChange={(e) => setWhId(e.target.value)} className="rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <button onClick={expStock} disabled={pending || !whId} className={btn}><Download className="h-4 w-4" /> Exportar plantilla</button>
          <input ref={stockInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) impStock(f); e.target.value = ""; }} />
          <button onClick={() => stockInput.current?.click()} disabled={pending || !whId} className={btnPrimary}><Upload className="h-4 w-4" /> Importar</button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-card p-5">
        <div className="mb-1 flex items-center gap-2"><MapPin className="h-4 w-4 text-muted" /><h2 className="font-medium text-ink">Ubicaciones (fila · estante · cubículo)</h2></div>
        <p className="mb-3 text-sm text-muted">Exportá, completá <span className="font-medium text-ink">fila / estante / cubículo</span> por variante y reimportá. En blanco = borra esa ubicación.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={expUbic} disabled={pending} className={btn}><Download className="h-4 w-4" /> Exportar plantilla</button>
          <input ref={ubicInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) impUbic(f); e.target.value = ""; }} />
          <button onClick={() => ubicInput.current?.click()} disabled={pending} className={btnPrimary}><Upload className="h-4 w-4" /> Importar</button>
        </div>
      </div>
    </div>
  );
}
