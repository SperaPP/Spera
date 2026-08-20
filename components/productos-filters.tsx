"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

type Ref = { id: string; name: string };

const ctl = "rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function ProductosFilters({ categories }: { categories: Ref[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function push(next: URLSearchParams) {
    const qs = next.toString();
    router.replace(qs ? `/productos?${qs}` : "/productos", { scroll: false });
  }
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value); else next.delete(key);
    next.delete("page"); // al cambiar un filtro, volvés a la primera página
    push(next);
  }
  function onSearch(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setParam("q", v.trim()), 300);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Buscar por nombre o código…" className={`${ctl} w-full pl-9`} />
      </div>
      <select value={sp.get("cat") ?? ""} onChange={(e) => setParam("cat", e.target.value)} className={ctl}>
        <option value="">Todas las categorías</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select value={sp.get("foto") ?? ""} onChange={(e) => setParam("foto", e.target.value)} className={ctl}>
        <option value="">Foto: todas</option>
        <option value="sin">Sin foto</option>
        <option value="con">Con foto</option>
      </select>
      <select value={sp.get("estado") ?? ""} onChange={(e) => setParam("estado", e.target.value)} className={ctl}>
        <option value="">Estado: todos</option>
        <option value="activo">Activos</option>
        <option value="inactivo">Inactivos</option>
      </select>
      <select value={sp.get("ciclo") ?? ""} onChange={(e) => setParam("ciclo", e.target.value)} className={ctl}>
        <option value="">Ciclo: todos</option>
        <option value="actual">Actual</option>
        <option value="discontinuo">Discontinuo</option>
      </select>
    </div>
  );
}
