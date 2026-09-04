import Link from "next/link";
import { Plus, Users, GitMerge } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { SolicitudesPortal } from "@/components/solicitudes-portal";

const FISCAL_LABEL: Record<string, string> = {
  consumidor_final: "Consumidor Final",
  responsable_inscripto: "Responsable Inscripto",
  monotributo: "Monotributo",
  exento: "Exento",
};

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function ClientesPage() {
  const sb = await createClient();
  const [{ data: customers }, { data: pend }, { data: tipos }, { data: isAdmin }] = await Promise.all([
    sb.from("customers").select("id, name, fiscal_condition, balance, active, portal_status, customer_types(name)").order("name").limit(200),
    sb.from("customers").select("id, name, doc_type, doc_number, email, phone").eq("portal_status", "pendiente").order("created_at", { ascending: true }),
    sb.from("customer_types").select("id, name").order("name"),
    sb.rpc("is_admin"),
  ]);

  // La lista principal no muestra las solicitudes pendientes (van en su sección).
  const rows = (customers ?? []).filter((c) => c.portal_status !== "pendiente");
  const pendientes = (pend ?? []).map((p) => ({
    id: p.id, name: p.name, doc: p.doc_number ? `${p.doc_type ?? ""} ${p.doc_number}`.trim() : null, email: p.email, phone: p.phone,
  }));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Clientes</h1>
          <p className="mt-1 text-sm text-muted">Clientes, tipo y cuenta corriente.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isAdmin === true && (
            <Link href="/clientes/duplicados" className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">
              <GitMerge className="h-4 w-4" /> Duplicados
            </Link>
          )}
          <Link
            href="/clientes/nuevo"
            className="flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" />
            Nuevo cliente
          </Link>
        </div>
      </div>

      <SolicitudesPortal pending={pendientes} tipos={tipos ?? []} />

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Users className="h-5 w-5" />
          </span>
          <p className="mt-3 font-medium text-ink">Todavía no hay clientes</p>
          <p className="mt-1 text-sm text-muted">Creá el primero para vender con su lista de precios.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Cond. fiscal</th>
                <th className="px-4 py-3 text-right font-medium">Saldo cta. cte.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const balance = Number(c.balance);
                return (
                  <tr key={c.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/clientes/${c.id}`} className="text-ink transition-colors hover:text-accent">{c.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{relName(c.customer_types) ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{FISCAL_LABEL[c.fiscal_condition] ?? c.fiscal_condition}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={balance > 0 ? "text-danger" : balance < 0 ? "text-ok" : "text-muted"}>
                        {formatMoney(balance)}
                      </span>
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
