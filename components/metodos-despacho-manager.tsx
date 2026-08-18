"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Truck, Plus } from "lucide-react";
import { crearMetodoDespacho, toggleMetodoDespacho } from "@/app/(app)/configuracion/actions";

type Method = { id: string; name: string; active: boolean };

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function MetodosDespachoManager({ methods }: { methods: Method[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");

  function crear() {
    if (!name.trim()) return;
    start(async () => {
      const r = await crearMetodoDespacho(name.trim());
      if (r.error) { toast.error(r.error); return; }
      toast.success("Método agregado."); setName(""); router.refresh();
    });
  }
  function toggle(m: Method) {
    start(async () => {
      const r = await toggleMetodoDespacho(m.id, !m.active);
      if (r.error) toast.error(r.error); else router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Truck className="h-4 w-4 text-muted" />
        <h3 className="text-sm font-medium text-ink">Métodos de despacho</h3>
      </div>
      <div className="mb-3 flex gap-2">
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") crear(); }} placeholder="Ej. OCA, Andreani, Moto…" />
        <button onClick={crear} disabled={pending || !name.trim()} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"><Plus className="h-4 w-4" /> Agregar</button>
      </div>
      <div className="divide-y divide-line rounded-lg border border-line">
        {methods.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
            <span className={m.active ? "text-ink" : "text-muted line-through"}>{m.name}</span>
            <button onClick={() => toggle(m)} disabled={pending} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${m.active ? "bg-ok-bg text-ok" : "bg-canvas text-muted"}`}>{m.active ? "Activo" : "Inactivo"}</button>
          </div>
        ))}
        {methods.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted">Sin métodos.</p>}
      </div>
    </div>
  );
}
