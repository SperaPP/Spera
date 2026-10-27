"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Package,
  Boxes,
  ArrowLeftRight,
  ShoppingCart,
  Receipt,
  Truck,
  PackagePlus,
  Users,
  Tags,
  Wallet,
  HandCoins,
  BarChart3,
  Settings,
  ShieldCheck,
  ScrollText,
  Sparkles,
  Store,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { canView, type Perms } from "@/lib/permissions";

type NavItem = { href: string; label: string; icon: LucideIcon; module?: string; adminOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/pos", label: "Punto de venta", icon: ShoppingCart, module: "pos" },
  { href: "/ventas", label: "Ventas", icon: Receipt, module: "ventas" },
  { href: "/logistica", label: "Logística", icon: Truck, module: "logistica" },
  { href: "/reposiciones", label: "Reposiciones", icon: PackagePlus, module: "reposiciones" },
  { href: "/productos", label: "Productos", icon: Package, module: "productos" },
  { href: "/stock", label: "Stock", icon: Boxes, module: "stock" },
  { href: "/transferencias", label: "Transferencias", icon: ArrowLeftRight, module: "transferencias" },
  { href: "/clientes", label: "Clientes", icon: Users, module: "clientes" },
  { href: "/precios", label: "Listas de precios", icon: Tags, module: "precios" },
  { href: "/caja", label: "Caja", icon: Wallet, module: "caja" },
  { href: "/cobranzas", label: "Cobranzas", icon: HandCoins, module: "cobranzas" },
  { href: "/reportes", label: "Reportes", icon: BarChart3, module: "reportes" },
  { href: "/asistente", label: "Asistente", icon: Sparkles, module: "asistente" },
  { href: "/configuracion", label: "Configuración", icon: Settings, module: "configuracion" },
  { href: "/tiendanube", label: "Tiendanube", icon: Store, adminOnly: true },
  { href: "/usuarios", label: "Usuarios y roles", icon: ShieldCheck, adminOnly: true },
  { href: "/auditoria", label: "Auditoría", icon: ScrollText, adminOnly: true },
];

export function Sidebar({ perms, isAdmin }: { perms: Perms; isAdmin: boolean }) {
  const pathname = usePathname();
  // Celular: el menú es un panel deslizable (en desktop queda fijo como siempre).
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const content = (
    <>
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg">
          S
        </span>
        <span className="text-[17px] font-semibold text-white">Spera</span>
        <span className="text-[11px] text-sidebar-muted">Bodysculpt</span>
        <button onClick={() => setOpen(false)} aria-label="Cerrar menú" className="ml-auto rounded-md p-1 text-sidebar-muted hover:text-white md:hidden">
          <X className="h-5 w-5" />
        </button>
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
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors md:py-2",
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
    </>
  );

  return (
    <>
      {/* Desktop: fijo a la izquierda */}
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar md:flex print:hidden">{content}</aside>

      {/* Celular: botón de menú (arriba a la izquierda, sobre el header) + panel */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        className="fixed left-3 top-3 z-40 flex h-8 w-8 items-center justify-center rounded-lg text-ink hover:bg-canvas md:hidden print:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden print:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col bg-sidebar shadow-xl">{content}</aside>
        </div>
      )}
    </>
  );
}
