"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Tag, Layers, Square, Play } from "lucide-react";
import {
  prepararSaleTN, syncSaleTNLote, prepararConciliacionTN, conciliarTNLote, type WorkItem,
} from "@/app/(app)/tiendanube/sync-actions";
import type { ItemResult } from "@/lib/tiendanube-sync";

type Mode = "sale" | "conciliar";
const BATCH = 3;

type Totales = { creados: number; actualizados: number; omitidos: number; errores: number; vinculadas: number; variantes: number; fotos: number; precios: number };
const ZERO: Totales = { creados: 0, actualizados: 0, omitidos: 0, errores: 0, vinculadas: 0, variantes: 0, fotos: 0, precios: 0 };

function sumar(t: Totales, r: ItemResult): Totales {
  return {
    creados: t.creados + (r.action === "creado" ? 1 : 0),
    actualizados: t.actualizados + (r.action === "actualizado" ? 1 : 0),
    omitidos: t.omitidos + (r.action === "omitido" ? 1 : 0),
    errores: t.errores + (r.action === "error" ? 1 : 0),
    vinculadas: t.vinculadas + (r.vinculadas ?? 0),
    variantes: t.variantes + (r.action === "creado" ? 0 : (r.variantesCreadas ?? 0)),
    fotos: t.fotos + (r.fotosSubidas ?? 0),
    precios: t.precios + (r.precios ?? 0),
  };
}

function Runner({ mode }: { mode: Mode }) {
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [sinPareja, setSinPareja] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [tot, setTot] = useState<Totales>(ZERO);
  const [log, setLog] = useState<ItemResult[]>([]);
  const stop = useRef(false);
  const [sinStock, setSinStock] = useState(false);

  const isSale = mode === "sale";
  const nuevos = items?.filter((i) => !i.tnProductId).length ?? 0;
  const existentes = (items?.length ?? 0) - nuevos;
  const porNombre = items?.filter((i) => i.how === "nombre").length ?? 0;

  async function preparar() {
    setPreparing(true); setItems(null); setLog([]); setTot(ZERO); setDone(0);
    const r = isSale ? await prepararSaleTN() : await prepararConciliacionTN();
    setPreparing(false);
    if (!r.ok) { toast.error(r.error); return; }
    setItems(r.items);
    if ("sinPareja" in r) setSinPareja(r.sinPareja as string[]);
  }

  async function correr() {
    if (!items?.length) return;
    const msg = isSale
      ? `Se van a sincronizar ${items.length} productos SALE: ${existentes} ya existen en Tiendanube (se les pone precio de lista + rebajado; su visibilidad no cambia) y ${nuevos} se CREAN OCULTOS. ¿Seguir?`
      : `Se van a conciliar ${items.length} productos de Tiendanube: vincular variantes, escribir el SKU de Spera, crear talles/colores faltantes y agregar fotos faltantes. No toca precios ni visibilidad. ¿Seguir?`;
    if (!confirm(msg)) return;
    stop.current = false; setRunning(true);
    let t = ZERO; const all: ItemResult[] = [];
    // El servidor procesa lo que le da el tiempo y devuelve cuántos hizo: se avanza por eso.
    let i = 0, fallas = 0;
    while (i < items.length && !stop.current) {
      const lote = items.slice(i, i + BATCH);
      let r: Awaited<ReturnType<typeof syncSaleTNLote>>;
      try {
        r = isSale ? await syncSaleTNLote(lote) : await conciliarTNLote(lote, sinStock);
      } catch {
        // Corte de red o de la función: reintentar el MISMO lote es seguro (no duplica: antes
        // de crear se busca el vínculo y el SKU). Tras 3 fallas seguidas, se frena.
        if (++fallas >= 3) { toast.error("Se cortó la conexión varias veces. Frenado: volvé a apretar para seguir."); break; }
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }
      if (!r.ok) { toast.error(r.error); break; }
      if (!r.results.length) { toast.error("El servidor no procesó nada en este lote; frenado."); break; }
      fallas = 0;
      for (const x of r.results) { t = sumar(t, x); all.push(x); }
      i += r.results.length;
      setTot(t); setLog([...all]); setDone(i);
    }
    setRunning(false);
    toast.success(stop.current ? "Sincronización frenada." : "Sincronización terminada.");
  }

  const pct = items?.length ? Math.round((done / items.length) * 100) : 0;
  const conNotas = log.filter((r) => r.action === "error" || r.notas.length);

  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
        {isSale ? <Tag className="h-4 w-4 text-danger" /> : <Layers className="h-4 w-4 text-accent" />}
        {isSale ? "Sincronizar productos SALE" : "Conciliar catálogo (variantes, SKU y fotos)"}
      </h3>
      <p className="mt-1 text-sm text-muted">
        {isSale
          ? "Los productos que el portal muestra como Sale. Los que ya están en Tiendanube quedan con precio de lista Público (tachado) + promo Público (rebajado), sin cambiar su visibilidad. Los que no están se crean OCULTOS, en la categoría SALE, con fotos, talles y stock."
          : "Para los productos que ya están en Tiendanube: los vincula con Spera (por SKU, o por nombre + talle/color si el match es inequívoco), les escribe el SKU de Spera, crea los talles/colores que faltan y agrega las fotos que faltan. Nunca crea productos duplicados ni borra fotos."}
      </p>

      {!items && (
        <button onClick={preparar} disabled={preparing} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-60">
          {preparing ? "Analizando Tiendanube…" : "Ver qué se va a hacer"}
        </button>
      )}

      {items && (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg bg-canvas px-3 py-2 text-sm text-ink">
            <strong>{items.length}</strong> productos ·{" "}
            {isSale ? <><strong>{existentes}</strong> ya en Tiendanube{porNombre ? ` (${porNombre} por nombre)` : ""} · <strong>{nuevos}</strong> a crear ocultos</>
              : <><strong>{items.length - porNombre}</strong> por SKU · <strong>{porNombre}</strong> por nombre{sinPareja.length ? <> · <strong>{sinPareja.length}</strong> de Tiendanube sin pareja en Spera</> : null}</>}
          </div>

          {!running && done === 0 && !isSale && (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={sinStock} onChange={(e) => setSinStock(e.target.checked)} />
              Crear también talles/colores <strong>sin stock</strong> (por defecto solo los que tienen stock en Central)
            </label>
          )}
          {!running && done === 0 && (
            <div className="flex flex-wrap gap-2">
              <button onClick={correr} disabled={!items.length} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
                <Play className="h-4 w-4" /> {isSale ? "Sincronizar SALE" : "Conciliar ahora"}
              </button>
              <button onClick={() => setItems(null)} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
            </div>
          )}

          {(running || done > 0) && (
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>{done}/{items.length} · {tot.creados} creados · {tot.actualizados} actualizados · {tot.vinculadas} variantes vinculadas · {tot.variantes} talles/colores nuevos · {tot.fotos} fotos · {tot.precios} precios{tot.errores ? ` · ${tot.errores} con error` : ""}</span>
                {running && <button onClick={() => { stop.current = true; }} className="inline-flex items-center gap-1 text-danger hover:underline"><Square className="h-3 w-3" /> Frenar</button>}
              </div>
            </div>
          )}

          {conNotas.length > 0 && (
            <details className="rounded-lg border border-line" open={!running}>
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink">Para revisar ({conNotas.length})</summary>
              <ul className="max-h-64 divide-y divide-line overflow-y-auto text-xs">
                {conNotas.map((r, i) => (
                  <li key={i} className="px-3 py-1.5">
                    <span className={r.action === "error" ? "font-medium text-danger" : "font-medium text-ink"}>{r.name}</span>
                    <span className="text-muted"> — {r.notas.join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {!isSale && sinPareja.length > 0 && (
            <details className="rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-ink">Productos de Tiendanube sin pareja en Spera ({sinPareja.length})</summary>
              <p className="px-3 pt-1 text-xs text-muted">No comparten SKU ni nombre exacto con un producto de Spera. Para vincularlos: renombralos igual en un lado o el otro, o cargales el SKU de Spera en Tiendanube.</p>
              <ul className="max-h-48 overflow-y-auto px-3 py-1.5 text-xs text-muted">{sinPareja.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export function TNSyncMasivo() {
  return (
    <div className="space-y-4">
      <Runner mode="sale" />
      <Runner mode="conciliar" />
    </div>
  );
}
