import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPermissions } from "@/lib/auth";
import { canView, canEdit } from "@/lib/permissions";
import { ControlStock } from "@/components/control-stock";

export default async function ControlStockPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Control de stock</h1>
      <p className="mt-1 mb-5 text-sm text-muted">Contá por escaneo (o por categoría) y ajustá el stock del sistema al conteo real.</p>
      <ControlStock warehouses={warehouses ?? []} categories={categories ?? []} canApply={canEdit(perms, "control_stock")} />
    </div>
  );
}
