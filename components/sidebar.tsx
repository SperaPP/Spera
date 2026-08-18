"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Package,
  Boxes,
  ArrowLeftRight,
  ShoppingCart,
  Receipt,
  RefreshCw,
  Truck,
  Users,
  Tags,
  Wallet,
  HandCoins,
  BarChart3,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { canView, type Perms } from "@/lib/permissions";

type NavItem = { href: string; label: string; icon: LucideIcon; module?: string; adminOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/pos", label: "Punto de venta", icon: ShoppingCart, module: "pos" },
  { href: "/ventas", label: "Ventas", icon: Receipt, module: "ventas" },
  { href: "/cambios", label: "Cambios", icon: RefreshCw, module: "pos" },
  { href: "/logistica", label: "Logística", icon: Truck, module: "logistica" },
  { href: "/productos", label: "Productos", icon: Package, module: "productos" },
  { href: "/stock", label: "Stock", icon: Boxes, module: "stock" },
  { href: "/transferencias", label: "Transferencias", icon: ArrowLeftRight, module: "transferencias" },
  { href: "/clientes", label: "Clientes", icon: Users, module: "clientes" },
  { href: "/precios", label: "Listas de precios", icon: Tags, module: "precios" },
  { href: "/caja", label: "Caja", icon: Wallet, module: "caja" },
  { href: "/cobranzas", label: "Cobranzas", icon: HandCoins, module: "cobranzas" },
  { href: "/reportes", label: "Reportes", icon: BarChart3, module: "reportes" },
  { href: "/configuracion", label: "Configuración", icon: Settings, module: "configuracion" },
  { href: "/usuarios", label: "Usuarios y roles", icon: ShieldCheck, adminOnly: true },
];

export function Sidebar({ perms, isAdmin }: { perms: Perms; isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-sidebar print:hidden">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg">
          S
        </span>
        <span className="text-[17px] font-semibold text-white">Spera</span>
        <span className="text-[11px] text-sidebar-muted">Bodysculpt</span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {NAV.filter((i) => (!i.module || canView(perms, i.module)) && (!i.adminOnly || isAdmin)).map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-active font-medium text-white"
                  : "text-sidebar-muted hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
