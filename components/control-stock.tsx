"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ScanLine, Plus, Minus, ClipboardCheck, RotateCcw } from "lucide-react";
import { escanearConteo, cargarCategoriaConteo, aplicarConteo, type CountProduct } from "@/app/(app)/stock/control/actions";

type Ref = { id: string; name: string };

const input =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15";
const card = "rounded-2xl border border-line bg-card p-5 shadow-sm";

export function ControlStock({ warehouses, categories, canApply }: { warehouses: Ref[]; categories: Ref[]; canApply: boolean }) {
  const [whId, setWhId] = useState(warehouses[0]?.id ?? "");
  const [catId, setCatId] = useState("");
  const [scope, setScope] = useState<CountProduct[]>([]);
  const [counted, setCounted] = useState<Record<string, number>>({});
  const [pending, start] = useTransition();

  function reset() { setScope([]); setCounted({}); setCatId(""); }
  function changeWh(id: string) { setWhId(id); reset(); }

  function addProducts(prods: CountProduct[]) {
    setScope((prev) => {
      const have = new Set(prev.map((p) => p.id));
      return [...prev, ...prods.filter((p) => !have.has(p.id))];
    });
  }

  function scan(code: string) {
    if (!code.trim()) return;
    start(async () => {
      const r = await escanearConteo(code, whId);
      if (!r.ok) { toast.error(r.error); return; }
      addProducts([r.product]);
      setCounted((p) => ({ ...p, [r.variantId]: (p[r.variantId] ?? 0) + 1 }));
    });
  }
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

      {scope.length === 0 ? (
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

          <div className={`${card} flex flex-wrap items-center gap-3`}>
            <div className="text-sm">
              <span className="text-muted">Productos: </span><span className="font-medium text-ink">{scope.length}</span>
              <span className="ml-4 text-muted">Con diferencia: </span><span className={`font-medium ${diffs.length ? "text-warn" : "text-ok"}`}>{diffs.length}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={reset} className="flex items-center gap-1.5 rounded-xl border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"><RotateCcw className="h-4 w-4" /> Limpiar</button>
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
