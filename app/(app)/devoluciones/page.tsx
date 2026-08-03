import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DevolucionesList, type DevolucionRow } from "@/components/devoluciones-list";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function DevolucionesPage() {
  const sb = await createClient();
  const { data } = await sb
    .from("returns")
    .select("id, number, status, total, created_at, customers(name), stores(name), return_items(count)")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows: DevolucionRow[] = (data ?? []).map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    total: Number(r.total),
    createdAt: r.created_at,
    customer: relName(r.customers) ?? "—",
    store: relName(r.stores) ?? "—",
    items: (r.return_items as { count: number }[] | null)?.[0]?.count ?? 0,
  }));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Devoluciones</h1>
          <p className="mt-1 text-sm text-muted">Al aprobar, reingresa el stock y suma saldo a favor al cliente.</p>
        </div>
        <Link
          href="/devoluciones/nueva"
          className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          Nueva devolución
        </Link>
      </div>

      <DevolucionesList rows={rows} />
    </div>
  );
}
