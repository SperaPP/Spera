"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ShoppingCart } from "lucide-react";

export type CartItem = {
  variantId: string; productId: string; name: string; label: string | null;
  price: number; qty: number; image: string | null; maxStock: number;
};

type CartCtx = {
  items: CartItem[];
  add: (item: CartItem) => void;
  setQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  count: number;
  total: number;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = "portal_cart_v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) setItems(JSON.parse(raw)); } catch { /* ignore */ }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(KEY, JSON.stringify(items)); }, [items, ready]);

  const api = useMemo<CartCtx>(() => ({
    items,
    add: (item) => setItems((prev) => {
      const i = prev.findIndex((x) => x.variantId === item.variantId);
      if (i >= 0) { const n = [...prev]; n[i] = { ...n[i], qty: Math.min(item.maxStock, n[i].qty + item.qty) }; return n; }
      return [...prev, { ...item, qty: Math.min(item.maxStock, item.qty) }];
    }),
    setQty: (variantId, qty) => setItems((prev) => prev.flatMap((x) => x.variantId === variantId ? (qty <= 0 ? [] : [{ ...x, qty: Math.min(x.maxStock, qty) }]) : [x])),
    remove: (variantId) => setItems((prev) => prev.filter((x) => x.variantId !== variantId)),
    clear: () => setItems([]),
    count: items.reduce((a, x) => a + x.qty, 0),
    total: items.reduce((a, x) => a + x.qty * x.price, 0),
  }), [items]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart fuera de CartProvider");
  return c;
}

export function CartButton() {
  const { count } = useCart();
  return (
    <Link href="/portal/carrito" className="relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas">
      <ShoppingCart className="h-5 w-5" />
      {count > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-fg">{count}</span>}
    </Link>
  );
}
