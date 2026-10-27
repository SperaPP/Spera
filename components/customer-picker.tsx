"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { buscarClientesPOS } from "@/app/(app)/pos/actions";

export type PickedCustomer = Awaited<ReturnType<typeof buscarClientesPOS>>[number];

const input =
  "w-full rounded-lg border border-line-strong bg-card py-2 pl-9 pr-3 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

/** Buscador de clientes por nombre, DNI/CUIT o email (mín. 2 letras). Reemplaza a los
 *  desplegables con cientos de clientes. Arranca vacío: nunca elige uno "por defecto". */
export function CustomerPicker({
  value, onChange, placeholder = "Buscar cliente por nombre, DNI/CUIT o email…", autoFocus,
}: {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await buscarClientesPOS(term);
      if (my === seq.current) { setResults(r); setLoading(false); setOpen(true); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    const bal = value.balance;
    return (
      <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft/40 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{value.name}</div>
          <div className="flex flex-wrap gap-x-3 text-xs text-muted">
            {value.docNumber && <span>{value.docType ?? "Doc"} {value.docNumber}</span>}
            {value.profileName && <span>{value.profileName}</span>}
            <span className={bal > 0 ? "text-danger" : bal < 0 ? "text-ok" : ""}>
              {bal > 0 ? `Debe ${formatMoney(bal)}` : bal < 0 ? `A favor ${formatMoney(-bal)}` : "Sin saldo"}
            </span>
          </div>
        </div>
        <button type="button" onClick={() => { onChange(null); setQ(""); setResults([]); }} className="rounded-md p-1 text-muted hover:text-ink" aria-label="Cambiar cliente" title="Cambiar cliente">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const term = q.trim();
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Enter" && results.length === 1) { e.preventDefault(); onChange(results[0]); } }}
        placeholder={placeholder}
        className={input}
      />
      {open && term.length >= 2 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-card shadow-lg">
          {loading && results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">Buscando…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">Sin resultados para &quot;{term}&quot;.</p>
          ) : results.map((c) => (
            <button
              key={c.id} type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(c); setOpen(false); }}
              className="flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left last:border-0 hover:bg-canvas"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{c.name}</div>
                <div className="truncate text-xs text-muted">{[c.docNumber && `${c.docType ?? "Doc"} ${c.docNumber}`, c.profileName, c.email].filter(Boolean).join(" · ")}</div>
              </div>
              {c.balance !== 0 && (
                <span className={`shrink-0 text-xs tabular-nums ${c.balance > 0 ? "text-danger" : "text-ok"}`}>
                  {c.balance > 0 ? `Debe ${formatMoney(c.balance)}` : `A favor ${formatMoney(-c.balance)}`}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
