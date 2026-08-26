import Link from "next/link";
import { Plus, ArrowLeftRight, ArrowRight, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  creada: { label: "Creada", cls: "bg-accent-soft text-accent" },
  enviada: { label: "Enviada", cls: "bg-warn-bg text-warn" },
  recibida: { label: "Recibida", cls: "bg-ok-bg text-ok" },
  cancelada: { label: "Cancelada", cls: "bg-danger-bg text-danger" },
};

export default async function TransferenciasPage() {
  const sb = await createClient();
  const { data } = await sb
    .from("stock_transfers")
    .select("id, status, created_at, from_warehouse:warehouses!from_warehouse_id(name), to_warehouse:warehouses!to_warehouse_id(name), stock_transfer_items(count)")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = data ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Transferencias</h1>
          <p className="mt-1 text-sm text-muted">Movimiento de stock entre depósitos.</p>
        </div>
        <Link
          href="/transferencias/nueva"
          className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          Nueva transferencia
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <ArrowLeftRight className="h-5 w-5" />
          </span>
          <p className="mt-3 font-medium text-ink">No hay transferencias</p>
          <p className="mt-1 text-sm text-muted">Creá una para mover stock entre depósitos.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Movimiento</th>
                <th className="px-4 py-3 text-right font-medium">Ítems</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const st = STATUS[t.status] ?? { label: t.status, cls: "bg-canvas text-muted" };
                return (
                  <tr key={t.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3 text-muted">{formatDateTime(t.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2 text-ink">
                        {relName(t.from_warehouse) ?? "—"}
                        <ArrowRight className="h-3.5 w-3.5 text-faint" />
                        {relName(t.to_warehouse) ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">
                      {(t.stock_transfer_items as { count: number }[] | null)?.[0]?.count ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/transferencias/${t.id}`} className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas">
                        {t.status === "creada" ? "Enviar" : t.status === "enviada" ? "Recibir" : "Ver"} <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
