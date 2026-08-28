import { createClient } from "@/lib/supabase/server";
import { PreciosManager, type ListaInfo } from "@/components/precios-manager";

export default async function PreciosPage() {
  const sb = await createClient();

  const [{ data: lists }, { data: types }, { count: totalProducts }] = await Promise.all([
    sb.from("price_lists").select("id, name, active").eq("active", true).order("name"),
    sb.from("customer_types").select("name, price_list_id"),
    sb.from("products").select("*", { count: "exact", head: true }),
  ]);

  const infos: ListaInfo[] = [];
  for (const l of lists ?? []) {
    const { count } = await sb
      .from("price_list_items")
      .select("*", { count: "exact", head: true })
      .eq("price_list_id", l.id)
      .is("variant_id", null);
    const usedBy = (types ?? []).filter((t) => t.price_list_id === l.id).map((t) => t.name);
    infos.push({ id: l.id, name: l.name, priced: count ?? 0, usedBy, derived: l.name === "Publico" });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Listas de precios</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Cada lista se edita por separado (acá con Excel, o en cada producto). Al cargar un producto nuevo, Publico se inicializa en Mayorista × 2, pero después es editable. Sumá un precio promocional en la columna <span className="font-medium text-ink">promo</span> del Excel o en el producto.
      </p>
      <PreciosManager lists={infos} totalProducts={totalProducts ?? 0} />
    </div>
  );
}
