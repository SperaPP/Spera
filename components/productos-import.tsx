"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Download, Upload, Boxes, MapPin, PackagePlus, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  exportarStock, importarStock, exportarUbicaciones, importarUbicaciones,
  previewProductos, importarProductos, type ImportRow, type ImportPreview,
} from "@/app/(app)/productos/import-actions";

type Warehouse = { id: string; name: string };

const COLS = ["producto", "descripcion", "categoria_principal", "categoria", "temporada", "tela", "talle", "color", "sku", "precio_mayorista", "stock", "fila", "estante", "cubiculo", "destacado"] as const;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, "_");
// Tolera encabezados con typos frecuentes (ej: "ubiulo" por "cubiculo").
const ALIAS: Record<string, string> = { ubiulo: "cubiculo", ubiculo: "cubiculo", cubicu: "cubiculo", cubiculos: "cubiculo", precio_mayorista_: "precio_mayorista" };

export function ProductosImport({ warehouses }: { warehouses: Warehouse[] }) {
  const [whId, setWhId] = useState(warehouses[0]?.id ?? "");
  const [pending, start] = useTransition();
  const prodInput = useRef<HTMLInputElement>(null);
  const stockInput = useRef<HTMLInputElement>(null);
  const ubicInput = useRef<HTMLInputElement>(null);

  const [prodRows, setProdRows] = useState<ImportRow[] | null>(null);
  const [prodPrev, setProdPrev] = useState<ImportPreview | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const whName = warehouses.find((w) => w.id === whId)?.name ?? "deposito";

  // ── Alta de productos ────────────────────────────────────────
  function plantillaProductos() {
    const ejemplo = [
      { producto: "Calza Push Up", descripcion: "", categoria_principal: "Mujer", categoria: "Calzas", temporada: "Primavera-Verano", tela: "Algodón", talle: "M", color: "Negro", sku: "1001", precio_mayorista: 5000, stock: 10, fila: 3, estante: 2, cubiculo: 1, destacado: "si" },
      { producto: "Calza Push Up", descripcion: "", categoria_principal: "Mujer", categoria: "Calzas", temporada: "Primavera-Verano", tela: "Algodón", talle: "L", color: "Negro", sku: "1002", precio_mayorista: 5000, stock: 8, fila: 3, estante: 2, cubiculo: 1, destacado: "si" },
      { producto: "Gorra Logo", descripcion: "", categoria_principal: "Hombre", categoria: "Gorras", temporada: "Atemporal", tela: "", talle: "", color: "Negro", sku: "2001", precio_mayorista: 3200, stock: 15, fila: "", estante: "", cubiculo: "", destacado: "" },
    ];
    const ws = XLSX.utils.json_to_sheet(ejemplo, { header: [...COLS] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos");
    XLSX.writeFile(wb, "plantilla-productos.xlsx");
  }

  function elegirProductos(file: File) {
    start(async () => {
      let rows: ImportRow[];
      try {
        const wb = XLSX.read(await file.arrayBuffer());
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
        rows = json.map((raw) => {
          const m: Record<string, unknown> = {};
          for (const k of Object.keys(raw)) { const nk = norm(k); m[ALIAS[nk] ?? nk] = raw[k]; }
          const g = (c: string) => { const v = m[c]; return v == null ? "" : String(v).trim(); };
          return {
            producto: g("producto"), descripcion: g("descripcion"),
            categoria_principal: g("categoria_principal"), categoria: g("categoria"),
            temporada: g("temporada"), tela: g("tela"), talle: g("talle"), color: g("color"),
            sku: g("sku"), precio_mayorista: g("precio_mayorista"), stock: g("stock"),
            fila: g("fila"), estante: g("estante"), cubiculo: g("cubiculo"), destacado: g("destacado"),
          };
        });
      } catch { toast.error("No se pudo leer el archivo."); return; }
      const r = await previewProductos(rows);
      if (r.error || !r.preview) { toast.error(r.error ?? "No se pudo leer la vista previa."); return; }
      setProdRows(rows); setProdPrev(r.preview);
    });
  }

  function confirmarProductos() {
    if (!prodRows || !whId) return;
    start(async () => {
      // Agrupar por producto (nombre) — las filas de un producto NO se pueden separar
      // entre lotes — y procesar de a tandas para no cortar por tiempo.
      const byProd = new Map<string, ImportRow[]>();
      for (const r of prodRows) {
        const k = r.producto?.trim().toLowerCase();
        if (!k) continue;
        let arr = byProd.get(k); if (!arr) { arr = []; byProd.set(k, arr); }
        arr.push(r);
      }
      const groups = [...byProd.values()];
      const BATCH = 200; // productos por lote (evita cortes por tiempo)
      const lotes = Math.ceil(groups.length / BATCH) || 1;
      let totP = 0, totV = 0;
      for (let i = 0; i < groups.length; i += BATCH) {
        setProgress(`Importando lote ${Math.floor(i / BATCH) + 1} de ${lotes}…`);
        const rows = groups.slice(i, i + BATCH).flat();
        const r = await importarProductos(whId, rows);
        if (r.error) { setProgress(null); toast.error(`Se cortó en el lote ${Math.floor(i / BATCH) + 1}: ${r.error}`); return; }
        totP += r.productos ?? 0; totV += r.variantes ?? 0;
      }
      setProgress(null);
      toast.success(`Listo: ${totP} productos y ${totV} variantes creadas.`);
      setProdRows(null); setProdPrev(null);
    });
  }

  const bloqueado = !!prodPrev && (prodPrev.dupEnArchivo.length > 0 || prodPrev.dupEnBase.length > 0 || prodPrev.variantes === 0);

  // ── Stock ────────────────────────────────────────────────────
  function expStock() {
    start(async () => {
      const r = await exportarStock(whId);
      if (r.error || !r.rows) { toast.error(r.error ?? "No se pudo exportar"); return; }
      const ws = XLSX.utils.json_to_sheet(r.rows, { header: ["sku", "producto", "variante", "cantidad"] });
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Stock");
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
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Ubicaciones");
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
      {/* Alta de productos */}
      <div className="rounded-xl border border-line bg-card p-5">
        <div className="mb-1 flex items-center gap-2"><PackagePlus className="h-4 w-4 text-muted" /><h2 className="font-medium text-ink">Alta de productos</h2></div>
        <p className="mb-3 text-sm text-muted">Una fila por variante; se agrupan por <span className="font-medium text-ink">producto</span> (mismo nombre). Los talles, colores, categorías y temporadas que no existan se crean solos. El stock inicial va al depósito elegido.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={whId} onChange={(e) => setWhId(e.target.value)} className="rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <button onClick={plantillaProductos} disabled={pending} className={btn}><Download className="h-4 w-4" /> Descargar plantilla</button>
          <input ref={prodInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) elegirProductos(f); e.target.value = ""; }} />
          <button onClick={() => prodInput.current?.click()} disabled={pending || !whId} className={btnPrimary}><Upload className="h-4 w-4" /> Elegir Excel</button>
        </div>

        {prodPrev && (
          <div className="mt-4 rounded-lg border border-line bg-canvas p-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-muted">Se crearían: <span className="font-semibold text-ink">{prodPrev.productos}</span> productos · <span className="font-semibold text-ink">{prodPrev.variantes}</span> variantes</span>
              <span className="text-muted">Stock a: <span className="font-medium text-ink">{whName}</span></span>
            </div>
            {(prodPrev.sinProducto > 0 || prodPrev.sinSku > 0) && (
              <p className="mt-2 text-xs text-muted">{prodPrev.sinProducto > 0 && `${prodPrev.sinProducto} fila(s) sin producto se ignoran. `}{prodPrev.sinSku > 0 && `${prodPrev.sinSku} fila(s) sin SKU se ignoran.`}</p>
            )}
            {prodPrev.dupEnArchivo.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-danger"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> SKU repetidos en el archivo: {prodPrev.dupEnArchivo.join(", ")}</p>
            )}
            {prodPrev.dupEnBase.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-danger"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> SKU que ya existen en el sistema: {prodPrev.dupEnBase.join(", ")}</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button onClick={confirmarProductos} disabled={pending || bloqueado} className={btnPrimary}>
                <CheckCircle2 className="h-4 w-4" /> {pending ? "Creando…" : "Confirmar importación"}
              </button>
              <button onClick={() => { setProdRows(null); setProdPrev(null); }} disabled={pending} className={btn}>Cancelar</button>
              {progress && <span className="text-xs font-medium text-accent">{progress}</span>}
              {!progress && bloqueado && prodPrev.variantes > 0 && <span className="text-xs text-danger">Resolvé los SKU repetidos antes de importar.</span>}
              {!progress && prodPrev.variantes > 500 && !bloqueado && <span className="text-xs text-muted">Se importa por lotes; puede tardar un rato.</span>}
            </div>
          </div>
        )}
      </div>

      {/* Stock */}
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

      {/* Ubicaciones */}
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
