import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, Clock, XCircle } from "lucide-react";
import { getPortalCustomer } from "@/lib/portal";
import { CartProvider, CartButton } from "@/components/portal-cart";
import { logoutPortal } from "../actions";

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

  return (
    <CartProvider>
      <div className="min-h-screen bg-canvas">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-line bg-card px-4 sm:px-6">
          <Link href="/portal" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg">B</span>
            <span className="font-semibold text-ink">Portal Mayorista</span>
          </Link>
          <Link href="/portal/catalogo" className="text-sm font-medium text-muted transition-colors hover:text-ink">Catálogo</Link>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <span className="hidden text-sm text-muted sm:inline">{customer.name}</span>
            <CartButton />
            <form action={logoutPortal}>
              <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-canvas hover:text-ink">
                <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Salir</span>
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </CartProvider>
  );
}
