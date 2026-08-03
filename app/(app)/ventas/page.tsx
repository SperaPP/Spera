import Link from "next/link";
import { Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDateTime } from "@/lib/format";
import { ProductSearch } from "@/components/product-search";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function VentasPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const sb = await createClient();

  const sel = "id, number, created_at, total, customers(name), stores(name), sale_items(count)";
  let req = sb.from("sales").select(sel).eq("status", "completada").order("created_at", { ascending: false }).limit(100);

  if (query) {
    const isNum = /^\d+$/.test(query);
    const { data: custs } = await sb.from("customers").select("id").ilike("name", `%${query}%`).limit(50);
    const custIds = (custs ?? []).map((c) => c.id);
    if (isNum && custIds.length) req = req.or(`number.eq.${Number(query)},customer_id.in.(${custIds.join(",")})`);
    else if (isNum) req = req.eq("number", Number(query));
    else if (custIds.length) req = req.in("customer_id", custIds);
    else req = req.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  const { data: rows } = await req;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Ventas</h1>
      <p className="mt-1 mb-4 text-sm text-muted">Historial de ventas del punto de venta.</p>

      <div className="mb-4">
        <ProductSearch basePath="/ventas" placeholder="Buscar por N° de venta o cliente…" />
      </div>

      {(rows ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Receipt className="h-5 w-5" />
          </span>
          <p className="mt-3 font-medium text-ink">{query ? `Sin resultados para "${query}"` : "Todavía no hay ventas"}</p>
          <p className="mt-1 text-sm text-muted">Las ventas del POS van a aparecer acá.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Local</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 text-right font-medium">Ítems</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/ventas/${s.id}`} className="text-ink transition-colors hover:text-accent">{s.number}</Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDateTime(s.created_at)}</td>
                  <td className="px-4 py-3 text-muted">{relName(s.stores) ?? "—"}</td>
                  <td className="px-4 py-3 text-ink">{relName(s.customers) ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{(s.sale_items as { count: number }[] | null)?.[0]?.count ?? 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-ink">{formatMoney(Number(s.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
