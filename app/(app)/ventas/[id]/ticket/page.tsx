import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TicketPrint, type TicketSale } from "@/components/ticket-print";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ regalo?: string }>;
}) {
  const { id } = await params;
  const { regalo } = await searchParams;
  const sb = await createClient();

  const { data: sale } = await sb
    .from("sales")
    .select("id, number, created_at, subtotal, discount, total, stores(name), organizations(name), sale_items(product_name, variant_label, quantity, unit_price, line_total), sale_payments(amount, payment_methods(name))")
    .eq("id", id)
    .single();
  if (!sale) notFound();

  const shaped: TicketSale = {
    id: sale.id,
    number: sale.number,
    createdAt: sale.created_at,
    orgName: relName(sale.organizations) ?? "Bodysculpt",
    storeName: relName(sale.stores),
    subtotal: Number(sale.subtotal),
    discount: Number(sale.discount),
    total: Number(sale.total),
    items: (sale.sale_items ?? []) as TicketSale["items"],
    payments: ((sale.sale_payments ?? []) as { amount: number; payment_methods: unknown }[]).map((p) => ({
      name: relName(p.payment_methods),
      amount: Number(p.amount),
    })),
  };

  return <TicketPrint sale={shaped} gift={regalo === "1"} />;
}
