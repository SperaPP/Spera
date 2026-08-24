"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Minus, Plus, Trash2, ShoppingCart, CheckCircle2, ImageOff } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/components/portal-cart";
import { crearPedidoPortal } from "@/app/portal/actions";

export default function CarritoPage() {
  const { items, setQty, remove, clear, total, count } = useCart();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ number?: number } | null>(null);

  function confirmar() {
    if (items.length === 0) return;
    start(async () => {
      const r = await crearPedidoPortal(items.map((i) => ({ variantId: i.variantId, quantity: i.qty })));
      if (r.error) { toast.error(r.error); return; }
      clear();
      setDone({ number: r.number });
    });
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-ok/30 bg-ok-bg p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-ok/15 text-ok"><CheckCircle2 className="h-6 w-6" /></span>
        <h1 className="mt-4 text-lg font-semibold text-ink">¡Pedido confirmado!{done.number ? ` #${done.number}` : ""}</h1>
        <p className="mt-1.5 text-sm text-muted">Lo estamos preparando. El total quedó cargado en tu cuenta corriente.</p>
        <Link href="/portal/catalogo" className="mt-5 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover">Seguir comprando</Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight text-ink">Tu pedido</h1>
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-card py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent"><ShoppingCart className="h-6 w-6" /></span>
          <p className="mt-3 font-medium text-ink">Todavía no agregaste productos</p>
          <Link href="/portal/catalogo" className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover">Ver catálogo</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-ink">Tu pedido</h1>

      <div className="divide-y divide-line rounded-2xl border border-line bg-card">
        {items.map((i) => (
          <div key={i.variantId} className="flex items-center gap-3 p-3">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-canvas text-faint">
              {i.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={i.image} alt="" className="h-full w-full object-cover" />
                : <ImageOff className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{i.name}</div>
              <div className="text-xs text-muted">{i.label ?? "Único"} · {formatMoney(i.price)}</div>
            </div>
            <div className="flex items-center rounded-lg border border-line-strong">
              <button onClick={() => setQty(i.variantId, i.qty - 1)} className="p-1.5 text-muted hover:text-ink"><Minus className="h-3.5 w-3.5" /></button>
              <input value={i.qty} onChange={(e) => setQty(i.variantId, Number(e.target.value) || 0)} className="w-10 border-0 bg-transparent text-center text-sm tabular-nums outline-none" />
              <button onClick={() => setQty(i.variantId, i.qty + 1)} className="p-1.5 text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /></button>
            </div>
            <div className="w-24 text-right text-sm font-semibold tabular-nums text-ink">{formatMoney(i.qty * i.price)}</div>
            <button onClick={() => remove(i.variantId)} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-col items-end gap-3">
        <div className="flex items-baseline gap-3">
          <span className="text-sm text-muted">Total ({count} u.)</span>
          <span className="text-2xl font-bold tabular-nums text-ink">{formatMoney(total)}</span>
        </div>
        <button onClick={confirmar} disabled={pending} className="w-full max-w-xs rounded-2xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Confirmando…" : "Confirmar pedido"}
        </button>
        <p className="text-xs text-muted">El total se carga a tu cuenta corriente. Sin pago online por ahora.</p>
      </div>
    </div>
  );
}
