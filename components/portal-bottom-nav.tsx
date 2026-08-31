"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store, Package, User } from "lucide-react";

const tabs = [
  { href: "/portal/catalogo", label: "Catálogo", icon: Store, match: (p: string) => p === "/portal" || p.startsWith("/portal/catalogo") || p.startsWith("/portal/producto") },
  { href: "/portal/pedidos", label: "Pedidos", icon: Package, match: (p: string) => p.startsWith("/portal/pedidos") },
  { href: "/portal/cuenta", label: "Mi cuenta", icon: User, match: (p: string) => p.startsWith("/portal/cuenta") },
];

/** Barra de navegación inferior — solo en móvil (en desktop se usa el header). */
export function PortalBottomNav() {
  const path = usePathname() ?? "";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-card pb-[env(safe-area-inset-bottom)] sm:hidden">
      {tabs.map((t) => {
        const active = t.match(path);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${active ? "text-accent" : "text-muted hover:text-ink"}`}
          >
            <Icon className="h-5 w-5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
