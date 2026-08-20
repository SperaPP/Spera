"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { setPrecioMayorista } from "@/app/(app)/productos/actions";

export function PrecioEditor({
  productId,
  mayorista,
  publico,
  canEdit,
}: {
  productId: string;
  mayorista: number | null;
  publico: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(mayorista != null ? String(mayorista) : "");

  const preview = val.trim() !== "" && isFinite(Number(val)) ? Math.round(Number(val) * 2) : null;

  function save() {
    const n = Number(val);
    if (!isFinite(n) || n < 0) return toast.error("Precio inválido.");
    start(async () => {
      const r = await setPrecioMayorista(productId, n);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Precio actualizado. Publico recalculado (×2).");
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Price label="Mayorista (base)" value={mayorista} accent />
          <Price label="Publico (×2)" value={publico} />
        </div>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas">
            {mayorista != null ? "Editar precio" : "Cargar precio"}
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Precio Mayorista (base)</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">$</span>
              <input autoFocus type="number" min={0} value={val} onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
                className="w-40 rounded-lg border border-line-strong bg-card px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
            </div>
          </div>
          <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
            {pending ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
          <p className="w-full text-xs text-muted">Publico se calcula solo: {preview != null ? <span className="font-medium text-ink">{formatMoney(preview)}</span> : "Mayorista × 2"}.</p>
        </div>
      )}
    </div>
  );
}

function Price({ label, value, accent }: { label: string; value: number | null; accent?: boolean }) {
  return (
    <div>
      <span className="text-muted">{label}: </span>
      <span className={accent ? "font-semibold text-accent" : "font-medium text-ink"}>
        {value != null ? formatMoney(value) : "—"}
      </span>
    </div>
  );
}
