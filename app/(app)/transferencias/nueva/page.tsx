import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NuevaTransferenciaForm } from "@/components/nueva-transferencia-form";

export default async function NuevaTransferenciaPage() {
  const sb = await createClient();
  const { data: warehouses } = await sb.from("warehouses").select("id, name").eq("active", true).order("name");

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/transferencias" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        Volver a transferencias
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Nueva transferencia</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Mové stock de un depósito a otro. Se valida que haya existencia en el origen.</p>

      <NuevaTransferenciaForm warehouses={warehouses ?? []} />
    </div>
  );
}
