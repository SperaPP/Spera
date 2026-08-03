import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NuevoClienteForm } from "@/components/nuevo-cliente-form";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function NuevoClientePage() {
  const sb = await createClient();
  const { data: types } = await sb
    .from("customer_types")
    .select("id, name, default_fiscal_condition, price_lists(name)")
    .eq("active", true)
    .order("name");

  const customerTypes = (types ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    defaultFiscal: t.default_fiscal_condition as string,
    priceListName: relName(t.price_lists),
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/clientes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a clientes
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Nuevo cliente</h1>
      <p className="mt-1 mb-6 text-sm text-muted">El tipo define la lista de precios que se aplica en el POS.</p>

      <NuevoClienteForm customerTypes={customerTypes} />
    </div>
  );
}
