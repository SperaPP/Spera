"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { agregarCatalogo, toggleCatalogo, type CatalogKind } from "@/app/(app)/configuracion/actions";

type Item = { id: string; name: string; active: boolean };

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function CatalogManager({ kind, title, items }: { kind: CatalogKind; title: string; items: Item[] }) {
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();

  const q = filter.trim().toLowerCase();
  const shown = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  const activos = items.filter((i) => i.active).length;

  function add() {
    const clean = name.trim();
    if (!clean) return;
    start(async () => {
      const r = await agregarCatalogo(kind, clean);
      if (r.error) { toast.error(r.error); return; }
      toast.success(`${clean} agregado`);
      setName("");
    });
  }

  function toggle(id: string, active: boolean) {
    start(async () => {
      const r = await toggleCatalogo(kind, id, active);
      if (r.error) toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-col rounded-xl border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <span className="text-xs text-muted">{activos} activos · {items.length} total</span>
      </div>

      <div className="border-b border-line p-3">
        <div className="flex gap-2">
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder={`Agregar a ${title.toLowerCase()}…`}
          />
          <button
            onClick={add}
            disabled={pending || !name.trim()}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {items.length > 20 && (
          <input className={`${input} mt-2`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filtrar entre ${items.length}…`} />
        )}
      </div>

      <div className="max-h-72 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">Sin ítems.</p>
        ) : (
          shown.map((i) => (
            <div key={i.id} className="flex items-center justify-between border-b border-line px-4 py-2 last:border-0">
              <span className={cn("text-sm", i.active ? "text-ink" : "text-faint line-through")}>{i.name}</span>
              <button
                onClick={() => toggle(i.id, !i.active)}
                disabled={pending}
                title={i.active ? "Desactivar" : "Activar"}
                className={cn("rounded-md p-1.5 transition-colors", i.active ? "text-muted hover:bg-canvas hover:text-ink" : "text-faint hover:bg-canvas")}
              >
                {i.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
