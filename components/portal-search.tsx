"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

export function PortalSearch({ defaultValue = "" }: { defaultValue?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(defaultValue);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); router.push(q.trim() ? `/portal/catalogo?q=${encodeURIComponent(q.trim())}` : "/portal/catalogo"); }}
      className="relative"
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar productos…"
        className="h-12 w-full rounded-xl border border-line-strong bg-card pl-11 pr-3 text-base text-ink outline-none transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15"
      />
    </form>
  );
}
