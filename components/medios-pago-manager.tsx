"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { crearMedioPago, toggleMedioPago, setRecargoMedio } from "@/app/(app)/configuracion/actions";

type Method = { id: string; name: string; kind: string; surcharge_pct: number; active: boolean };

const input =
  "rounded-lg border border-line-strong bg-card px-2 py-1 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

const KINDS = [
  { v: "efectivo", l: "Efectivo" },
  { v: "tarjeta", l: "Tarjeta" },
  { v: "transferencia", l: "Transferencia" },
  { v: "digital", l: "Digital" },
  { v: "otro", l: "Otro" },
];

export function MediosPagoManager({ methods }: { methods: Method[] }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("tarjeta");
  const [pending, start] = useTransition();

  function add() {
    if (!name.trim()) return;
    start(async () => {
      const r = await crearMedioPago(name.trim(), kind);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Medio agregado"); setName("");
    });
  }
  function run(fn: () => Promise<{ error?: string }>) {
    start(async () => { const r = await fn(); if (r.error) toast.error(r.error); });
  }

  return (
    <div className="rounded-xl border border-line bg-card">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-medium text-ink">Medios de pago</h2>
      </div>
      <div className="border-b border-line p-3">
        <div className="flex gap-2">
          <input className={`${input} flex-1`} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Nombre (ej. QR Modo)" />
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
          </select>
          <button onClick={add} disabled={pending || !name.trim()} className="flex items-center rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div>
        {methods.map((m) => (
          <div key={m.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
            <span className={cn("flex-1 text-sm", m.active ? "text-ink" : "text-faint line-through")}>{m.name}</span>
            <label className="flex items-center gap-1 text-xs text-muted">
              recargo
              <input
                type="number" min={0} step="0.5" defaultValue={m.surcharge_pct}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== m.surcharge_pct) run(() => setRecargoMedio(m.id, v)); }}
                className={`${input} w-16 text-right`}
              />%
            </label>
            <button onClick={() => run(() => toggleMedioPago(m.id, !m.active))} disabled={pending} title={m.active ? "Desactivar" : "Activar"} className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink">
              {m.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
