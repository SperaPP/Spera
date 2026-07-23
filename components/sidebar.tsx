"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Package,
  Boxes,
  ArrowLeftRight,
  ShoppingCart,
  RotateCcw,
  Truck,
  Users,
  Tags,
  Wallet,
  HandCoins,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { canView, type Perms } from "@/lib/permissions";

type NavItem = { href: string; label: string; icon: LucideIcon; module?: string };

const NAV: NavItem[] = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/pos", label: "Punto de venta", icon: ShoppingCart, module: "pos" },
  { href: "/devoluciones", label: "Devoluciones", icon: RotateCcw, module: "devoluciones" },
  { href: "/logistica", label: "Logística", icon: Truck, module: "logistica" },
  { href: "/productos", label: "Productos", icon: Package, module: "productos" },
  { href: "/stock", label: "Stock", icon: Boxes, module: "stock" },
  { href: "/transferencias", label: "Transferencias", icon: ArrowLeftRight, module: "transferencias" },
  { href: "/clientes", label: "Clientes", icon: Users, module: "clientes" },
  { href: "/precios", label: "Listas de precios", icon: Tags, module: "precios" },
  { href: "/caja", label: "Caja", icon: Wallet, module: "caja" },
  { href: "/cobranzas", label: "Cobranzas", icon: HandCoins, module: "cobranzas" },
  { href: "/configuracion", label: "Configuración", icon: Settings, module: "configuracion" },
];

export function Sidebar({ perms }: { perms: Perms }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="px-5 py-5">
        <span className="text-lg font-semibold tracking-tight">Spera</span>
        <span className="ml-2 text-xs text-neutral-400">Bodysculpt</span>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 pb-4">
        {NAV.filter((i) => !i.module || canView(perms, i.module)).map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                active
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
