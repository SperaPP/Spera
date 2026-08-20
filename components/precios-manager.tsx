"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Download, Upload, Tags } from "lucide-react";
import { exportarPrecios, importarPrecios } from "@/app/(app)/precios/actions";

export type ListaInfo = { id: string; name: string; priced: number; usedBy: string[]; derived: boolean };

export function PreciosManager({ lists, totalProducts }: { lists: ListaInfo[]; totalProducts: number }) {
  const [pending, start] = useTransition();
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  function exportar(l: ListaInfo) {
    start(async () => {
      const res = await exportarPrecios(l.id);
      if (res.error || !res.rows) { toast.error(res.error ?? "No se pudo exportar"); return; }
      const ws = XLSX.utils.json_to_sheet(res.rows, { header: ["id", "producto", "categoria", "precio"] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Precios");
      XLSX.writeFile(wb, `precios-${l.name.toLowerCase().replace(/\s+/g, "-")}.xlsx`);
      toast.success(`Exportados ${res.rows.length} productos.`);
    });
  }

  function importar(l: ListaInfo, file: File) {
    start(async () => {
      let rows: { id: string; precio: unknown }[];
      try {
        const wb = XLSX.read(await file.arrayBuffer());
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
        rows = json
          .map((r) => ({ id: String(r.id ?? "").trim(), precio: r.precio }))
          .filter((r) => r.id && r.precio !== "" && r.precio != null && isFinite(Number(r.precio)));
      } catch {
        toast.error("No se pudo leer el archivo.");
        return;
      }
      if (rows.length === 0) { toast.error("El archivo no tiene precios válidos (columnas id y precio)."); return; }
      const res = await importarPrecios(l.id, rows);
      if (res.error) toast.error(res.error);
      else toast.success(`Actualizados ${res.count} precios en ${l.name}.`);
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {lists.map((l) => (
          <div key={l.id} className="rounded-xl border border-line bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Tags className="h-4 w-4 text-muted" />
                  <h2 className="font-medium text-ink">{l.name}</h2>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {l.priced.toLocaleString("es-AR")} de {totalProducts.toLocaleString("es-AR")} con precio
                  {l.usedBy.length > 0 && <> · usada por {l.usedBy.join(", ")}</>}
                  {l.derived && <> · <span className="font-medium text-ink">= Mayorista × 2</span> (se calcula solo)</>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportar(l)}
                  disabled={pending}
                  className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-60"
                >
                  <Download className="h-4 w-4" /> Exportar
                </button>
                {!l.derived && (
                  <>
                    <input
                      ref={(el) => { fileInputs.current[l.id] = el; }}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(l, f); e.target.value = ""; }}
                    />
                    <button
                      onClick={() => fileInputs.current[l.id]?.click()}
                      disabled={pending}
                      className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
                    >
                      <Upload className="h-4 w-4" /> Importar
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Al importar la lista <span className="font-medium text-ink">Mayorista</span>, el Publico se recalcula solo (× 2).</p>
    </div>
  );
}
