import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPermissions } from "@/lib/auth";
import { canView, canEdit } from "@/lib/permissions";
import { StockInicial } from "@/components/stock-inicial";

export default async function StockInicialPage() {
  const perms = await getPermissions();
  if (!canView(perms, "control_stock")) redirect("/stock");

  const sb = await createClient();
  const [{ data: warehouses }, { data: categories }] = await Promise.all([
    sb.from("warehouses").select("id, name").eq("active", true).order("name"),
    sb.from("categories").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/stock" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a stock
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Stock inicial</h1>
      <p className="mt-1 mb-5 text-sm text-muted">Escaneá todo lo que estás ingresando y aplicá: las cantidades se <span className="font-medium text-ink">suman</span> al stock actual del depósito (no lo reemplazan). Ideal para dar de alta existencias o para ingresos de mercadería.</p>
      <StockInicial warehouses={warehouses ?? []} categories={categories ?? []} canApply={canEdit(perms, "control_stock")} />
    </div>
  );
}
