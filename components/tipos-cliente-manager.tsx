"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { asignarListaTipo, crearTipoCliente } from "@/app/(app)/configuracion/actions";

type Ref = { id: string; name: string };
type Type = { id: string; name: string; price_list_id: string | null; default_fiscal_condition: string };

const input =
  "rounded-lg border border-line-strong bg-card px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

const FISCAL = [
  { v: "consumidor_final", l: "Consumidor Final" },
  { v: "responsable_inscripto", l: "Responsable Inscripto" },
  { v: "monotributo", l: "Monotributo" },
  { v: "exento", l: "Exento" },
];

export function TiposClienteManager({ types, priceLists }: { types: Type[]; priceLists: Ref[] }) {
  const [name, setName] = useState("");
  const [listId, setListId] = useState(priceLists[0]?.id ?? "");
  const [fiscal, setFiscal] = useState("consumidor_final");
  const [pending, start] = useTransition();

  function add() {
    if (!name.trim()) return;
    start(async () => {
      const r = await crearTipoCliente(name.trim(), listId || null, fiscal);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Tipo creado"); setName("");
    });
  }

  return (
    <div className="rounded-xl border border-line bg-card">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-medium text-ink">Tipos de cliente</h2>
        <p className="mt-0.5 text-xs text-muted">La lista define qué precios ve el cliente en el POS.</p>
      </div>

      <div>
        {types.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <span className="flex-1 text-sm font-medium text-ink">{t.name}</span>
            <select
              value={t.price_list_id ?? ""}
              onChange={(e) => start(async () => { const r = await asignarListaTipo(t.id, e.target.value || null); if (r.error) toast.error(r.error); else toast.success("Lista asignada"); })}
              disabled={pending}
              className={input}
            >
              <option value="">Sin lista</option>
              {priceLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-3">
        <div className="flex flex-wrap gap-2">
          <input className={`${input} min-w-32 flex-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nuevo tipo (ej. VIP)" />
          <select className={input} value={listId} onChange={(e) => setListId(e.target.value)}>
            {priceLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select className={input} value={fiscal} onChange={(e) => setFiscal(e.target.value)}>
            {FISCAL.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
          </select>
          <button onClick={add} disabled={pending || !name.trim()} className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
            <Plus className="h-4 w-4" /> Crear
          </button>
        </div>
      </div>
    </div>
  );
}
