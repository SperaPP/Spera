"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ScanLine, Plus, Minus, ClipboardCheck, RotateCcw, Printer, AlertTriangle, Trash2 } from "lucide-react";
import { escanearConteo, cargarCategoriaConteo, aplicarConteo, type CountProduct } from "@/app/(app)/stock/control/actions";

type Ref = { id: string; name: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const input =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15";
const card = "rounded-2xl border border-line bg-card p-5 shadow-sm";

export function ControlStock({ warehouses, categories, canApply }: { warehouses: Ref[]; categories: Ref[]; canApply: boolean }) {
  const [whId, setWhId] = useState(warehouses[0]?.id ?? "");
  const [catId, setCatId] = useState("");
  const [scope, setScope] = useState<CountProduct[]>([]);
  const [counted, setCounted] = useState<Record<string, number>>({});
  const [unknown, setUnknown] = useState<Record<string, number>>({}); // código → veces escaneado
  const [pending, start] = useTransition();

  function reset() { setScope([]); setCounted({}); setUnknown({}); setCatId(""); }
  function changeWh(id: string) { setWhId(id); reset(); }

  function addProducts(prods: CountProduct[]) {
    setScope((prev) => {
      const have = new Set(prev.map((p) => p.id));
      return [...prev, ...prods.filter((p) => !have.has(p.id))];
    });
  }

  function scan(code: string) {
    const c = code.trim();
    if (!c) return;
    start(async () => {
      const r = await escanearConteo(c, whId);
      if (!r.ok) {
        if (r.notFound) {
          // No se pudo identificar: lo registro abajo para que el operador lo vea.
          setUnknown((u) => ({ ...u, [c]: (u[c] ?? 0) + 1 }));
          toast.warning(`Sin identificar: ${c}`);
        } else {
          toast.error(r.error);
        }
        return;
      }
      addProducts([r.product]);
      setCounted((p) => ({ ...p, [r.variantId]: (p[r.variantId] ?? 0) + 1 }));
    });
  }
  function delUnknown(code: string) { setUnknown((u) => { const n = { ...u }; delete n[code]; return n; }); }
  function loadCategory() {
    if (!catId) return;
    start(async () => {
      const r = await cargarCategoriaConteo(catId, whId);
      if (!r.ok) { toast.error(r.error); return; }
      if (r.products.length === 0) toast.message("Esa categoría no tiene productos.");
      addProducts(r.products);
      toast.success(`Categoría cargada: ${r.products.length} producto(s).`);
    });
  }
  function setQty(variantId: string, qty: number) {
    setCounted((p) => ({ ...p, [variantId]: Math.max(0, qty) }));
  }

  const allVariants = scope.flatMap((p) => p.variants);
  const diffs = allVariants.filter((v) => (counted[v.variantId] ?? 0) !== v.system);

  function aplicar() {
    if (allVariants.length === 0) return toast.error("No hay productos en el conteo.");
    if (!confirm(`Vas a ajustar ${diffs.length} variante(s) al conteo real. Esta acción modifica el stock. ¿Confirmar?`)) return;
    start(async () => {
      const r = await aplicarConteo({ warehouseId: whId, counts: allVariants.map((v) => ({ variantId: v.variantId, quantity: counted[v.variantId] ?? 0 })) });
      if (r.error) { toast.error(r.error); return; }
      toast.success(`Stock ajustado: ${r.count} variante(s).`);
      reset();
    });
  }

  const unknownEntries = Object.entries(unknown);

  function imprimirControl() {
    if (scope.length === 0 && unknownEntries.length === 0) return toast.error("No hay nada para imprimir.");
    const whName = warehouses.find((w) => w.id === whId)?.name ?? "—";
    const fecha = new Date().toLocaleString("es-AR");
    const rows = scope.flatMap((p) => p.variants.map((v) => {
      const c = counted[v.variantId] ?? 0;
      const d = c - v.system;
      const cls = d === 0 ? "" : d < 0 ? "neg" : "pos";
      const dtxt = d === 0 ? "OK" : d > 0 ? `+${d}` : `${d}`;
      return `<tr><td>${esc(p.name)}</td><td>${esc(v.label ?? "Única")}</td><td class="mono">${esc(v.sku ?? "—")}</td><td class="num">${v.system}</td><td class="num">${c}</td><td class="num ${cls}">${dtxt}</td></tr>`;
    })).join("");
    const unkRows = unknownEntries.map(([code, n]) => `<tr><td class="mono">${esc(code)}</td><td class="num">${n}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Control de stock</title><style>
      @page{size:A4 portrait;margin:12mm}
      *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0}
      h1{font-size:18px;margin:0}.sub{font-size:12px;color:#444;margin-top:2px}
      .meta{margin:6px 0 12px;font-size:12px;display:flex;gap:24px;flex-wrap:wrap}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}
      th{text-align:left;border-bottom:2px solid #000;padding:5px 6px;font-size:11px;text-transform:uppercase}
      td{border-bottom:1px solid #ccc;padding:5px 6px}
      .num{text-align:right;font-variant-numeric:tabular-nums}.mono{font-family:monospace;font-size:11px}
      .neg{color:#b00;font-weight:bold}.pos{color:#a60;font-weight:bold}
      h2{font-size:13px;margin:16px 0 4px}.warn{color:#a60}
      .firma{margin-top:28px;font-size:12px}
    </style></head><body>
      <h1>Control de stock</h1>
      <div class="sub">${esc(whName)}</div>
      <div class="meta"><span>Fecha: <b>${esc(fecha)}</b></span><span>Productos: <b>${scope.length}</b></span><span>Variantes con diferencia: <b>${diffs.length}</b></span><span>Sin identificar: <b>${unknownEntries.length}</b></span></div>
      <table><thead><tr><th>Producto</th><th>Variante</th><th>SKU</th><th class="num">Sistema</th><th class="num">Contado</th><th class="num">Dif.</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Sin productos contados.</td></tr>'}</tbody></table>
      ${unknownEntries.length ? `<h2 class="warn">Productos sin identificar</h2><table><thead><tr><th>Código escaneado</th><th class="num">Veces</th></tr></thead><tbody>${unkRows}</tbody></table>` : ""}
      <div class="firma">Controló: ____________________________    Firma: ____________________</div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return toast.error("Habilitá las ventanas emergentes para imprimir.");
    w.document.write(html); w.document.close(); w.focus(); w.print();
  }

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Sucursal / depósito</label>
            <select value={whId} onChange={(e) => changeWh(e.target.value)} className={input}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Cargar una categoría entera (opcional)</label>
            <div className="flex gap-2">
              <select value={catId} onChange={(e) => setCatId(e.target.value)} className={input}>
                <option value="">Elegí…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={loadCategory} disabled={pending || !catId} className="shrink-0 rounded-xl border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50">Cargar</button>
            </div>
          </div>
        </div>
        <div className="relative mt-3">
          <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" />
          <input autoFocus className={`${input} h-12 pl-11`} placeholder="Escaneá cada prenda física…"
            onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value; (e.target as HTMLInputElement).value = ""; scan(v); } }} />
        </div>
        <p className="mt-2 text-xs text-muted">Al escanear un producto entra al conteo con todas sus variantes. Las variantes que no cuentes de ese producto quedan en 0.</p>
      </div>

      {scope.length === 0 && unknownEntries.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-card py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><ClipboardCheck className="h-5 w-5" /></span>
          <p className="mt-3 font-medium text-ink">Empezá a escanear o cargá una categoría.</p>
        </div>
      ) : (
        <>
          {scope.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-xl border border-line bg-card">
              <div className="border-b border-line px-4 py-2.5 text-sm font-medium text-ink">{p.name}</div>
              <div className="divide-y divide-line">
                {p.variants.map((v) => {
                  const c = counted[v.variantId] ?? 0;
                  const diff = c - v.system;
                  return (
                    <div key={v.variantId} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink">{v.label ?? "Única"}</div>
                        {v.sku && <div className="font-mono text-xs text-muted">{v.sku}</div>}
                      </div>
                      <span className="w-24 text-right text-xs text-muted">sistema: {v.system}</span>
                      <div className="flex items-center rounded-lg border border-line-strong">
                        <button onClick={() => setQty(v.variantId, c - 1)} className="p-1.5 text-muted hover:text-ink"><Minus className="h-3.5 w-3.5" /></button>
                        <input value={c} onChange={(e) => setQty(v.variantId, Number(e.target.value) || 0)} className="w-12 border-0 bg-transparent text-center text-sm tabular-nums outline-none" />
                        <button onClick={() => setQty(v.variantId, c + 1)} className="p-1.5 text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                      <span className={`w-16 text-right text-xs font-medium tabular-nums ${diff === 0 ? "text-muted" : diff < 0 ? "text-danger" : "text-warn"}`}>
                        {diff === 0 ? "OK" : diff > 0 ? `+${diff}` : diff}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {unknownEntries.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-warn/40 bg-warn-bg/40">
              <div className="flex items-center gap-2 border-b border-warn/30 px-4 py-2.5 text-sm font-medium text-ink">
                <AlertTriangle className="h-4 w-4 text-warn" /> Productos sin identificar
                <span className="ml-auto text-xs font-normal text-muted">no entran en el ajuste — revisar</span>
              </div>
              <div className="divide-y divide-line">
                {unknownEntries.map(([code, n]) => (
                  <div key={code} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="font-mono text-sm text-ink">{code}</span>
                    {n > 1 && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">×{n}</span>}
                    <button onClick={() => delUnknown(code)} className="ml-auto text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`${card} flex flex-wrap items-center gap-3`}>
            <div className="text-sm">
              <span className="text-muted">Productos: </span><span className="font-medium text-ink">{scope.length}</span>
              <span className="ml-4 text-muted">Con diferencia: </span><span className={`font-medium ${diffs.length ? "text-warn" : "text-ok"}`}>{diffs.length}</span>
              {unknownEntries.length > 0 && <><span className="ml-4 text-muted">Sin identificar: </span><span className="font-medium text-warn">{unknownEntries.length}</span></>}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={reset} className="flex items-center gap-1.5 rounded-xl border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"><RotateCcw className="h-4 w-4" /> Limpiar</button>
              <button onClick={imprimirControl} className="flex items-center gap-1.5 rounded-xl border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"><Printer className="h-4 w-4" /> Imprimir control</button>
              <button onClick={aplicar} disabled={pending || !canApply} title={canApply ? "" : "Requiere permiso de Control de stock"} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50">
                {pending ? "Aplicando…" : "Aplicar ajuste"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
