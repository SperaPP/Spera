import { createClient } from "@/lib/supabase/server";
import { CatalogManager } from "@/components/catalog-manager";
import { MediosPagoManager } from "@/components/medios-pago-manager";
import { TiposClienteManager } from "@/components/tipos-cliente-manager";
import { DepositosManager, LocalesManager } from "@/components/locales-depositos-manager";
import { CuponesManager } from "@/components/cupones-manager";
import { MetodosDespachoManager } from "@/components/metodos-despacho-manager";

function relName(r: unknown): string | null {
  const o = Array.isArray(r) ? r[0] : r;
  return (o as { name: string } | null)?.name ?? null;
}

export default async function ConfiguracionPage() {
  const sb = await createClient();
  const [
    { data: categorias }, { data: colores }, { data: telas }, { data: talles },
    { data: principales }, { data: temporadas },
    { data: methods }, { data: types }, { data: priceLists },
    { data: warehouses }, { data: stores },
  ] = await Promise.all([
    sb.from("categories").select("id, name, active").order("name"),
    sb.from("colors").select("id, name, active").order("name"),
    sb.from("fabric_types").select("id, name, active").order("name"),
    sb.from("sizes").select("id, name, active").order("position").order("name"),
    sb.from("main_categories").select("id, name, active").order("position").order("name"),
    sb.from("seasons").select("id, name, active").order("position").order("name"),
    sb.from("payment_methods").select("id, name, kind, surcharge_pct, active").order("position"),
    sb.from("customer_types").select("id, name, price_list_id, default_fiscal_condition").order("name"),
    sb.from("price_lists").select("id, name").eq("active", true).order("name"),
    sb.from("warehouses").select("id, name, active").order("name"),
    sb.from("stores").select("id, name, active, has_cash_register, warehouses(name)").order("name"),
  ]);

  const { data: coupons } = await sb
    .from("coupons")
    .select("id, code, discount_type, discount_value, min_amount, max_uses, used_count, expires_at, active")
    .order("created_at", { ascending: false });

  const { data: shippingMethods } = await sb.from("shipping_methods").select("id, name, active").order("position");

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Configuración</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Catálogos, medios de pago, tipos de cliente, locales y depósitos. Desactivar oculta sin borrar.</p>

      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-faint">Catálogos del producto</h2>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CatalogManager kind="principales" title="Categorías principales" items={principales ?? []} />
        <CatalogManager kind="categorias" title="Categorías secundarias" items={categorias ?? []} />
        <CatalogManager kind="temporadas" title="Temporadas" items={temporadas ?? []} />
        <CatalogManager kind="talles" title="Talles" items={talles ?? []} />
        <CatalogManager kind="colores" title="Colores" items={colores ?? []} />
        <CatalogManager kind="telas" title="Tipos de tela" items={telas ?? []} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-wide text-faint">Precios</h2>
      <div className="rounded-xl border border-line bg-card p-5 text-sm text-muted">
        Dos listas: <span className="font-medium text-ink">Mayorista</span> (base, se carga a mano en cada producto) y{" "}
        <span className="font-medium text-ink">Publico</span> = Mayorista × 2 (se calcula solo). Sin excepciones por categoría.
      </div>

      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-wide text-faint">Cupones</h2>
      <CuponesManager coupons={(coupons ?? []).map((c) => ({
        id: c.id, code: c.code, discount_type: c.discount_type, discount_value: Number(c.discount_value),
        min_amount: c.min_amount != null ? Number(c.min_amount) : null,
        max_uses: c.max_uses != null ? Number(c.max_uses) : null,
        used_count: Number(c.used_count), expires_at: c.expires_at, active: c.active,
      }))} />

      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-wide text-faint">Ventas</h2>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <MediosPagoManager methods={(methods ?? []).map((m) => ({ ...m, surcharge_pct: Number(m.surcharge_pct) }))} />
        <TiposClienteManager types={types ?? []} priceLists={priceLists ?? []} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-wide text-faint">Logística</h2>
      <MetodosDespachoManager methods={shippingMethods ?? []} />

      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-wide text-faint">Locales y depósitos</h2>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <DepositosManager warehouses={warehouses ?? []} />
        <LocalesManager
          stores={(stores ?? []).map((s) => ({
            id: s.id, name: s.name, active: s.active, has_cash_register: s.has_cash_register,
            warehouseName: relName(s.warehouses),
          }))}
          warehouses={(warehouses ?? []).filter((w) => w.active)}
        />
      </div>
    </div>
  );
}
