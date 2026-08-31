import Link from "next/link";
import { Plus, HandCoins, ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDateTime } from "@/lib/format";

const CHANNEL_LABEL: Record<string, string> = {
  pos: "Venta", portal: "Venta portal", tiendanube: "Venta TN", cambio: "Cambio",
};

type Cobro = {
  kind: "cobranza" | "venta"; id: string; number: number; created_at: string;
  monto: number; anulada: boolean; channel: string | null; cliente: string;
  total_count: number; total_monto: number;
};

const PAGE_SIZE = 50;

export default async function CobranzasPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const sb = await createClient();
  const { data } = await sb.rpc("cobros_list", { p_limit: PAGE_SIZE, p_offset: offset });
  const rows = (data ?? []) as Cobro[];

  const total = rows[0] ? Number(rows[0].total_count) : 0;
  const totalMonto = rows[0] ? Number(rows[0].total_monto) : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : offset + 1;
  const to = offset + rows.length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Cobranzas</h1>
          <p className="mt-1 text-sm text-muted">Todo el dinero que ingresa: cobranzas a cuenta corriente y cobros de ventas (todos los canales).</p>
        </div>
        <Link
          href="/cobranzas/nueva"
          className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" />
          Nueva cobranza
        </Link>
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <HandCoins className="h-5 w-5" />
          </span>
          <p className="mt-3 font-medium text-ink">Todavía no hay ingresos</p>
          <p className="mt-1 text-sm text-muted">Los cobros de ventas y las cobranzas van a aparecer acá.</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-line bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Comprobante</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 text-right font-medium">Cobrado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const href = r.kind === "cobranza" ? `/cobranzas/${r.id}` : `/ventas/${r.id}`;
                  const label = r.kind === "cobranza" ? `Cobranza #${r.number}` : `${CHANNEL_LABEL[r.channel ?? ""] ?? "Venta"} #${r.number}`;
                  return (
                    <tr key={`${r.kind}-${r.id}`} className="border-b border-line last:border-0 hover:bg-canvas">
                      <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</td>
                      <td className="px-4 py-3">
                        <Link href={href} className="font-medium text-accent transition-colors hover:underline">{label}</Link>
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${r.kind === "cobranza" ? "bg-accent-soft text-accent" : "bg-canvas text-muted"}`}>
                          {r.kind === "cobranza" ? "Cobranza" : "Venta"}
                        </span>
                        {r.anulada && <span className="ml-2 rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-medium text-danger">Anulada</span>}
                      </td>
                      <td className="px-4 py-3 text-ink">{r.cliente}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${r.anulada ? "text-faint line-through" : "text-ink"}`}>{formatMoney(Number(r.monto))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-canvas/50">
                  <td colSpan={3} className="px-4 py-3 text-sm font-medium text-ink">Total ingresado (todo)</td>
                  <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-ink">{formatMoney(totalMonto)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs text-muted">Mostrando {from}–{to} de {total.toLocaleString("es-AR")}</span>
            <div className="flex items-center gap-2">
              <PageLink page={page - 1} disabled={page <= 1} dir="prev" />
              <span className="text-sm text-muted">Página {page} de {totalPages}</span>
              <PageLink page={page + 1} disabled={page >= totalPages} dir="next" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PageLink({ page, disabled, dir }: { page: number; disabled: boolean; dir: "prev" | "next" }) {
  const cls = "flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-muted transition-colors hover:bg-canvas hover:text-ink";
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  if (disabled) return <span className={`${cls} cursor-not-allowed opacity-40`}><Icon className="h-4 w-4" /></span>;
  return <Link href={`/cobranzas?page=${page}`} className={cls}><Icon className="h-4 w-4" /></Link>;
}
