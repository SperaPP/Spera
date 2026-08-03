"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { crearDeposito, toggleDeposito, crearLocal, toggleLocal } from "@/app/(app)/configuracion/actions";

type Warehouse = { id: string; name: string; active: boolean };
type Store = { id: string; name: string; active: boolean; has_cash_register: boolean; warehouseName: string | null };

const input =
  "rounded-lg border border-line-strong bg-card px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function DepositosManager({ warehouses }: { warehouses: Warehouse[] }) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function add() {
    if (!name.trim()) return;
    start(async () => { const r = await crearDeposito(name.trim()); if (r.error) { toast.error(r.error); return; } toast.success("Depósito creado"); setName(""); });
  }
  function run(fn: () => Promise<{ error?: string }>) { start(async () => { const r = await fn(); if (r.error) toast.error(r.error); }); }

  return (
    <div className="rounded-xl border border-line bg-card">
      <div className="border-b border-line px-4 py-3"><h2 className="text-sm font-medium text-ink">Depósitos</h2></div>
      <div className="border-b border-line p-3">
        <div className="flex gap-2">
          <input className={`${input} flex-1`} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Nombre del depósito" />
          <button onClick={add} disabled={pending || !name.trim()} className="flex items-center rounded-lg bg-accent px-3 text-accent-fg hover:bg-accent-hover disabled:opacity-60"><Plus className="h-4 w-4" /></button>
        </div>
      </div>
      <div>
        {warehouses.map((w) => (
          <div key={w.id} className="flex items-center justify-between border-b border-line px-4 py-2 last:border-0">
            <span className={cn("text-sm", w.active ? "text-ink" : "text-faint line-through")}>{w.name}</span>
            <button onClick={() => run(() => toggleDeposito(w.id, !w.active))} disabled={pending} title={w.active ? "Desactivar" : "Activar"} className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink">
              {w.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LocalesManager({ stores, warehouses }: { stores: Store[]; warehouses: Warehouse[] }) {
  const [name, setName] = useState("");
  const [whId, setWhId] = useState(warehouses[0]?.id ?? "");
  const [caja, setCaja] = useState(true);
  const [pending, start] = useTransition();

  function add() {
    if (!name.trim()) return;
    start(async () => { const r = await crearLocal(name.trim(), whId, caja); if (r.error) { toast.error(r.error); return; } toast.success("Local creado"); setName(""); });
  }
  function run(fn: () => Promise<{ error?: string }>) { start(async () => { const r = await fn(); if (r.error) toast.error(r.error); }); }

  return (
    <div className="rounded-xl border border-line bg-card">
      <div className="border-b border-line px-4 py-3"><h2 className="text-sm font-medium text-ink">Locales (puntos de venta)</h2></div>
      <div>
        {stores.map((s) => (
          <div key={s.id} className="flex items-center gap-3 border-b border-line px-4 py-2">
            <div className="flex-1">
              <div className={cn("text-sm font-medium", s.active ? "text-ink" : "text-faint line-through")}>{s.name}</div>
              <div className="text-xs text-muted">depósito: {s.warehouseName ?? "—"}{s.has_cash_register ? " · con caja" : ""}</div>
            </div>
            <button onClick={() => run(() => toggleLocal(s.id, !s.active))} disabled={pending} title={s.active ? "Desactivar" : "Activar"} className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink">
              {s.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
          </div>
        ))}
      </div>
      <div className="border-t border-line p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} min-w-32 flex-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nuevo local" />
          <select className={input} value={whId} onChange={(e) => setWhId(e.target.value)}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={caja} onChange={(e) => setCaja(e.target.checked)} className="h-4 w-4 accent-[color:var(--color-accent)]" />
            con caja
          </label>
          <button onClick={add} disabled={pending || !name.trim()} className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"><Plus className="h-4 w-4" /> Crear</button>
        </div>
      </div>
    </div>
  );
}
