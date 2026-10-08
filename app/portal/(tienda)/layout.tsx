import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, Clock, XCircle, Search, User } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { CartProvider, CartButton } from "@/components/portal-cart";
import { logoutPortal } from "../actions";

// Mensaje de la barra superior (editable).
const PROMO = "Mayorista Body Sculpt · Pedí online y pagá a cuenta corriente";
const navLinks = [
  { href: "/portal/catalogo", label: "Catálogo" },
  { href: "/portal/pedidos", label: "Pedidos" },
  { href: "/portal/cuenta", label: "Mi cuenta" },
];

export default async function TiendaLayout({ children }: { children: React.ReactNode }) {
  const { userId, customer } = await getPortalCustomer();
  if (!userId || !customer) redirect("/portal/login");

  // No aprobado todavía: no entra a la tienda.
  if (customer.portalStatus !== "aprobado") {
    const rechazado = customer.portalStatus === "rechazado";
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center">
          <span className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl ${rechazado ? "bg-danger-bg text-danger" : "bg-warn-bg text-warn"}`}>
            {rechazado ? <XCircle className="h-6 w-6" /> : <Clock className="h-6 w-6" />}
          </span>
          <h1 className="mt-4 text-lg font-semibold text-ink">{rechazado ? "Cuenta no habilitada" : "Tu cuenta está en revisión"}</h1>
          <p className="mt-1.5 text-sm text-muted">
            {rechazado
              ? "Tu solicitud no fue aprobada. Escribinos si creés que es un error."
              : "Estamos revisando tu registro. Te habilitamos a la brevedad para que puedas comprar."}
          </p>
          <form action={logoutPortal} className="mt-5">
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">
              <LogOut className="h-4 w-4" /> Salir
            </button>
          </form>
        </div>
      </main>
    );
  }

  const iconBtn = "flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-canvas hover:text-ink";

  return (
    <CartProvider>
      <div className="min-h-screen bg-canvas">
        <header className="sticky top-0 z-20 border-b border-line bg-card">
          {/* Barra promo */}
          <div className="bg-ink text-canvas">
            <p className="mx-auto max-w-6xl px-4 py-1.5 text-center text-[11px] font-medium tracking-wide sm:text-xs">{PROMO}</p>
          </div>

          {/* Header principal: nav (desktop) · logo centrado · íconos */}
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
            <nav className="hidden flex-1 items-center gap-6 sm:flex">
              {navLinks.map((l) => (
                <Link key={l.href} href={l.href} className="text-sm font-medium text-muted transition-colors hover:text-ink">{l.label}</Link>
              ))}
            </nav>

            <Link href="/portal" className="mr-auto flex-none sm:mr-0 sm:flex-none">
              <span className="text-lg font-bold uppercase tracking-[0.22em] text-ink">Body Sculpt</span>
            </Link>

            <div className="flex flex-1 items-center justify-end gap-1 sm:gap-1.5">
              <Link href="/portal/catalogo" aria-label="Buscar en el catálogo" className={iconBtn}><Search className="h-[18px] w-[18px]" /></Link>
              <Link href="/portal/cuenta" aria-label="Mi cuenta" className={`hidden sm:flex ${iconBtn}`}><User className="h-[18px] w-[18px]" /></Link>
              <CartButton />
              <form action={logoutPortal}>
                <button aria-label="Salir" className={iconBtn}><LogOut className="h-[18px] w-[18px]" /></button>
              </form>
            </div>
          </div>

          {/* Nav en celular (debajo del header) */}
          <nav className="flex items-center justify-center gap-6 border-t border-line px-4 py-2 sm:hidden">
            {navLinks.map((l) => (
              <Link key={l.href} href={l.href} className="text-sm font-medium text-muted transition-colors hover:text-ink">{l.label}</Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </CartProvider>
  );
}
