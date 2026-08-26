import Link from "next/link";
import { PackagePlus, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getStoreScope } from "@/lib/auth";

export default async function ReposicionesPage() {
  const sb = await createClient();
  const { storeId: scopeStore } = await getStoreScope();

  // Mostradores (no mayoristas).
  let storesReq = sb.from("stores").select("id, name").eq("is_wholesale", false).eq("active", true).order("name");
  if (scopeStore) storesReq = storesReq.eq("id", scopeStore);
  const [{ data: stores }, { data: pend }] = await Promise.all([
    storesReq,
    sb.from("replenishment_pending").select("store_id, qty").gt("qty", 0),
  ]);

  const byStore = new Map<string, { unidades: number; prendas: number }>();
  for (const p of pend ?? []) {
    const cur = byStore.get(p.store_id) ?? { unidades: 0, prendas: 0 };
    cur.unidades += Number(p.qty);
    cur.prendas += 1;
    byStore.set(p.store_id, cur);
  }

  const rows = (stores ?? []).map((s) => ({ id: s.id, name: s.name, ...(byStore.get(s.id) ?? { unidades: 0, prendas: 0 }) }));

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Reposiciones</h1>
        <p className="mt-1 text-sm text-muted">Lo vendido en cada mostrador que hay que reponer desde Mayorista-Central.</p>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-card py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><PackagePlus className="h-5 w-5" /></span>
          <p className="mt-3 font-medium text-ink">No hay mostradores</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Mostrador</th>
                <th className="px-4 py-3 text-right font-medium">Prendas a reponer</th>
                <th className="px-4 py-3 text-right font-medium">Unidades</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-canvas">
                  <td className="px-4 py-3 font-medium text-ink">{r.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{r.prendas}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{r.unidades}</td>
                  <td className="px-4 py-3 text-right">
                    {r.prendas > 0 ? (
                      <Link href={`/reposiciones/${r.id}`} className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas">
                        Abrir <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <span className="text-xs text-faint">Sin pendientes</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
