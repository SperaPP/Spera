import Link from "next/link";
import { ShoppingCart, Package, Boxes, Wallet, Users, Truck } from "lucide-react";

const CARDS = [
  { href: "/pos", label: "Punto de venta", icon: ShoppingCart, desc: "Vender y registrar cobros" },
  { href: "/productos", label: "Productos", icon: Package, desc: "Catálogo y variantes" },
  { href: "/stock", label: "Stock", icon: Boxes, desc: "Existencias por depósito" },
  { href: "/caja", label: "Caja", icon: Wallet, desc: "Turnos y cierres" },
  { href: "/clientes", label: "Clientes", icon: Users, desc: "Cuentas corrientes" },
  { href: "/logistica", label: "Logística", icon: Truck, desc: "Armado y despacho" },
];

export default function HomePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Inicio</h1>
      <p className="mt-1 text-sm text-muted">Bienvenido a Spera.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.href}
              href={c.href}
              className="group rounded-xl border border-line bg-card p-5 transition-colors hover:border-accent"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon className="h-5 w-5" />
              </span>
              <div className="mt-3 font-medium text-ink">{c.label}</div>
              <div className="text-sm text-muted">{c.desc}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
