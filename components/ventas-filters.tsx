"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

type Store = { id: string; name: string };

const ESTADOS = [
  { v: "", l: "Estado: todos" },
  { v: "pendiente", l: "En preparación" },
  { v: "controlado", l: "Controlado" },
  { v: "completado", l: "Completado" },
  { v: "anulada", l: "Anulada" },
];
const IMPRESO = [
  { v: "", l: "Armado: todos" },
  { v: "si", l: "Impresos" },
  { v: "no", l: "No impresos" },
];

const ctl =
  "rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function VentasFilters({ stores }: { stores: Store[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const store = params.get("store") ?? "";
  const desde = params.get("desde") ?? "";
  const hasta = params.get("hasta") ?? "";
  const impreso = params.get("impreso") ?? "";
  const estado = params.get("estado") ?? "";
  const active = store || desde || hasta || impreso || estado;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }
  function clear() {
    const next = new URLSearchParams(params.toString());
    ["store", "desde", "hasta", "impreso", "estado"].forEach((k) => next.delete(k));
    router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={store} onChange={(e) => setParam("store", e.target.value)} className={ctl}>
        <option value="">Local: todos</option>
        {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <select value={estado} onChange={(e) => setParam("estado", e.target.value)} className={ctl}>
        {ESTADOS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>

      <select value={impreso} onChange={(e) => setParam("impreso", e.target.value)} className={ctl}>
        {IMPRESO.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>

      <label className="flex items-center gap-1.5 text-sm text-muted">
        Desde <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setParam("desde", e.target.value)} className={ctl} />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-muted">
        Hasta <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setParam("hasta", e.target.value)} className={ctl} />
      </label>

      {active && (
        <button onClick={clear} className="flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-canvas hover:text-ink">
          <X className="h-3.5 w-3.5" /> Limpiar
        </button>
      )}
    </div>
  );
}
