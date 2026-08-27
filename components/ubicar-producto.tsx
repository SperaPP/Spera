"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { MapPin, Search, X, PackageSearch } from "lucide-react";
import { ubicarProducto, type UbicResult } from "@/app/(app)/productos/actions";

function ubicacionTexto(r: UbicResult): string {
  const parts: string[] = [];
  if (r.fila != null) parts.push(`Fila ${r.fila}`);
  if (r.estante != null) parts.push(`Estante ${r.estante}`);
  if (r.cubiculo != null) parts.push(`Cubículo ${r.cubiculo}`);
  return parts.join(" · ");
}

export function UbicarProducto() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UbicResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setResults([]); setSearched(false); return; }
    const t = setTimeout(() => {
      start(async () => {
        const res = await ubicarProducto(term);
        setResults(res);
        setSearched(true);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => { setOpen(false); setQ(""); setResults([]); setSearched(false); };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-line-strong px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas"
      >
        <MapPin className="h-4 w-4" /> Ubicar producto
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={close}>
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><MapPin className="h-4 w-4 text-accent" /> Ubicar producto</h2>
              <button type="button" onClick={close} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink"><X className="h-4 w-4" /></button>
            </div>

            <div className="p-5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscá por nombre, SKU o código de barras…"
                  className="w-full rounded-lg border border-line-strong bg-canvas py-2.5 pl-9 pr-3 text-sm text-ink outline-none focus:border-accent"
                />
              </div>

              <div className="mt-4 max-h-[45vh] overflow-y-auto">
                {q.trim().length < 2 ? (
                  <p className="py-8 text-center text-sm text-muted">Escribí al menos 2 caracteres para buscar.</p>
                ) : pending && !searched ? (
                  <p className="py-8 text-center text-sm text-muted">Buscando…</p>
                ) : results.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><PackageSearch className="h-5 w-5" /></span>
                    <p className="mt-2 text-sm text-muted">No se encontró ningún producto.</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                        <th className="px-2 py-2 font-medium">Producto</th>
                        <th className="px-2 py-2 font-medium">SKU</th>
                        <th className="px-2 py-2 font-medium">Ubicación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => {
                        const ubic = ubicacionTexto(r);
                        return (
                          <tr key={r.variantId} className="border-b border-line last:border-0">
                            <td className="px-2 py-2.5">
                              <div className="font-medium text-ink">{r.productName}{!r.active && <span className="ml-1.5 text-[11px] text-faint">(inactivo)</span>}</div>
                              {r.variantLabel && <div className="text-xs text-muted">{r.variantLabel}</div>}
                            </td>
                            <td className="px-2 py-2.5 tabular-nums text-muted">{r.sku ?? "—"}</td>
                            <td className="px-2 py-2.5">
                              {ubic ? <span className="font-medium text-ink">{ubic}</span> : <span className="text-faint">Sin ubicación cargada</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
