import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

const AR_OFFSET = "-03:00";
const PAGE_SIZE = 100;

// Etiquetas legibles por tabla.
const ENTITY: Record<string, string> = {
  sales: "Venta", receipts: "Cobranza", price_list_items: "Precio", stock_transfers: "Transferencia",
  cash_sessions: "Caja", profiles: "Usuario", roles: "Rol", role_permissions: "Permisos",
  products: "Producto", customers: "Cliente", stock_movements: "Ajuste de stock",
  tiendanube_credentials: "Tiendanube", coupons: "Cupón", payment_methods: "Medio de pago",
  stores: "Local", warehouses: "Depósito", categories: "Categoría", main_categories: "Categoría principal",
  seasons: "Temporada", sizes: "Talle", colors: "Color", fabric_types: "Tela", customer_types: "Tipo de cliente",
  shipping_methods: "Método de despacho",
};
const ACTION: Record<string, { label: string; cls: string }> = {
  insert: { label: "Creó", cls: "bg-ok-bg text-ok" },
  update: { label: "Modificó", cls: "bg-accent-soft text-accent" },
  delete: { label: "Eliminó", cls: "bg-danger-bg text-danger" },
};

function resumen(action: string, detail: Record<string, unknown>): string {
  if (action === "update") {
    const campos = Object.keys(detail).filter((k) => k !== "id" && k !== "organization_id");
    return campos.length ? `Cambió: ${campos.join(", ")}` : "—";
  }
  // insert / delete: mostrar un campo identificador
  const d = detail as Record<string, unknown>;
  const id = d.number ?? d.code ?? d.name ?? d.sku ?? d.email ?? null;
  return id != null ? String(id) : "—";
}

type Params = { actor?: string; entity?: string; desde?: string; hasta?: string; page?: string };

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sb = await createClient();
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  const { actor, entity, desde, hasta, page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const { data: profs } = await sb.from("profiles").select("id, full_name, email").order("full_name");
  const nameById = new Map((profs ?? []).map((p) => [p.id, p.full_name || p.email]));

  let req = sb.from("audit_log").select("id, actor_id, action, entity, entity_id, detail, created_at")
    .order("created_at", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (actor) req = req.eq("actor_id", actor);
  if (entity) req = req.eq("entity", entity);
  if (desde) req = req.gte("created_at", `${desde}T00:00:00${AR_OFFSET}`);
  if (hasta) req = req.lte("created_at", `${hasta}T23:59:59${AR_OFFSET}`);
  const { data: rows } = await req;

  const inp = "rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink";

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Auditoría</h1>
      <p className="mt-1 mb-5 text-sm text-muted">Registro de acciones: quién creó, modificó o eliminó cada cosa.</p>

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">Usuario
          <select name="actor" defaultValue={actor ?? ""} className={inp}>
            <option value="">Todos</option>
            {(profs ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">Entidad
          <select name="entity" defaultValue={entity ?? ""} className={inp}>
            <option value="">Todas</option>
            {Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">Desde
          <input type="date" name="desde" defaultValue={desde ?? ""} className={inp} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">Hasta
          <input type="date" name="hasta" defaultValue={hasta ?? ""} className={inp} />
        </label>
        <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover">Filtrar</button>
        <a href="/auditoria" className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Limpiar</a>
      </form>

      {(rows ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><ScrollText className="h-5 w-5" /></span>
          <p className="mt-3 font-medium text-ink">Sin registros</p>
          <p className="mt-1 text-sm text-muted">No hay actividad para estos filtros.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Usuario</th>
                <th className="px-4 py-3 font-medium">Acción</th>
                <th className="px-4 py-3 font-medium">Entidad</th>
                <th className="px-4 py-3 font-medium">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => {
                const a = ACTION[r.action] ?? { label: r.action, cls: "bg-canvas text-muted" };
                return (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatDateTime(r.created_at)}</td>
                    <td className="px-4 py-2.5 text-ink">{r.actor_id ? (nameById.get(r.actor_id) ?? "—") : <span className="text-faint">Sistema</span>}</td>
                    <td className="px-4 py-2.5"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${a.cls}`}>{a.label}</span></td>
                    <td className="px-4 py-2.5 text-ink">{ENTITY[r.entity] ?? r.entity}</td>
                    <td className="px-4 py-2.5 text-muted">{resumen(r.action, (r.detail ?? {}) as Record<string, unknown>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(rows ?? []).length === PAGE_SIZE && (
        <div className="mt-3 flex justify-center">
          <a href={`/auditoria?${new URLSearchParams({ ...(actor ? { actor } : {}), ...(entity ? { entity } : {}), ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), page: String(page + 1) }).toString()}`}
            className="rounded-lg border border-line-strong px-4 py-1.5 text-sm font-medium text-ink hover:bg-canvas">Ver más</a>
        </div>
      )}
    </div>
  );
}
