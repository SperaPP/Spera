import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EditarClienteForm } from "@/components/editar-cliente-form";

export default async function EditarClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();

  const [{ data: customer }, { data: types }] = await Promise.all([
    sb.from("customers").select("id, name, customer_type_id, fiscal_condition, doc_type, doc_number, email, phone, active").eq("id", id).single(),
    sb.from("customer_types").select("id, name, price_lists(name)").eq("active", true).order("name"),
  ]);
  if (!customer) notFound();

  const customerTypes = (types ?? []).map((t) => {
    const pl = t.price_lists as { name: string } | { name: string }[] | null;
    const priceListName = (Array.isArray(pl) ? pl[0]?.name : pl?.name) ?? null;
    return { id: t.id, name: t.name, priceListName };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/clientes/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" />
        Volver al cliente
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Editar cliente</h1>
      <p className="mt-1 mb-6 text-sm text-muted">La cuenta corriente no se modifica desde acá.</p>

      <EditarClienteForm
        customer={{
          id: customer.id, name: customer.name, customerTypeId: customer.customer_type_id ?? "",
          fiscalCondition: customer.fiscal_condition, docType: customer.doc_type ?? "",
          docNumber: customer.doc_number ?? "", email: customer.email ?? "", phone: customer.phone ?? "",
          active: customer.active,
        }}
        customerTypes={customerTypes}
      />
    </div>
  );
}
