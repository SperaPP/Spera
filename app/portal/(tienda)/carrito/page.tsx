"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Minus, Plus, Trash2, ShoppingCart, CheckCircle2, ImageOff, AlertTriangle } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { useCart } from "@/components/portal-cart";
import { crearPedidoPortal, stockDisponiblePortal } from "@/app/portal/actions";

export default function CarritoPage() {
  const { items, setQty, remove, clear, total, count } = useCart();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ number?: number } | null>(null);
  // Stock disponible actual por variante (null = todavía cargando).
  const [stock, setStock] = useState<Record<string, number> | null>(null);

  const varsKey = items.map((i) => i.variantId).sort().join(",");
  useEffect(() => {
    if (!varsKey) { setStock({}); return; }
    let alive = true;
    setStock(null);
    stockDisponiblePortal(varsKey.split(",")).then((s) => { if (alive) setStock(s); });
    return () => { alive = false; };
  }, [varsKey]);

  // Disponible de un ítem (mientras carga, usamos el que se guardó al agregar).
  const dispOf = (variantId: string, fallback: number) => (stock ? (stock[variantId] ?? 0) : fallback);
  const hayProblema = stock != null && items.some((i) => i.qty > (stock[i.variantId] ?? 0));

  function confirmar() {
    if (items.length === 0 || hayProblema) return;
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

      {hayProblema && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Algunos productos ya no tienen stock suficiente. Ajustá las cantidades (o quitalos) para poder confirmar.</span>
        </div>
      )}

      <div className="divide-y divide-line rounded-2xl border border-line bg-card">
        {items.map((i) => {
          const disp = dispOf(i.variantId, i.maxStock);
          const sinStock = stock != null && disp === 0;
          const excede = stock != null && i.qty > disp;
          const cap = stock != null ? disp : i.maxStock; // límite +/- según stock vivo
          return (
            <div key={i.variantId} className={`flex items-center gap-3 p-3 ${excede ? "bg-danger-bg/40" : ""}`}>
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-canvas text-faint">
                {i.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={i.image} alt="" className="h-full w-full object-cover" />
                  : <ImageOff className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{i.name}</div>
                <div className="text-xs text-muted">{i.label ?? "Único"} · {formatMoney(i.price)}</div>
                {sinStock ? (
                  <div className="mt-0.5 text-xs font-medium text-danger">Sin stock</div>
                ) : excede ? (
                  <div className="mt-0.5 text-xs font-medium text-danger">Solo {disp} disponible(s)</div>
                ) : null}
              </div>
              <div className="flex items-center rounded-lg border border-line-strong">
                <button onClick={() => setQty(i.variantId, i.qty - 1)} className="p-1.5 text-muted hover:text-ink"><Minus className="h-3.5 w-3.5" /></button>
                <input value={i.qty} onChange={(e) => setQty(i.variantId, Math.min(Number(e.target.value) || 0, cap))} className="w-10 border-0 bg-transparent text-center text-sm tabular-nums outline-none" />
                <button onClick={() => setQty(i.variantId, Math.min(i.qty + 1, cap))} disabled={i.qty >= cap} className="p-1.5 text-muted hover:text-ink disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <div className="w-24 text-right text-sm font-semibold tabular-nums text-ink">{formatMoney(i.qty * i.price)}</div>
              {excede && disp > 0 && (
                <button onClick={() => setQty(i.variantId, disp)} className="text-xs font-medium text-accent hover:underline">Ajustar</button>
              )}
              <button onClick={() => remove(i.variantId)} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col items-end gap-3">
        <div className="flex items-baseline gap-3">
          <span className="text-sm text-muted">Total ({count} u.)</span>
          <span className="text-2xl font-bold tabular-nums text-ink">{formatMoney(total)}</span>
        </div>
        <button onClick={confirmar} disabled={pending || hayProblema} className="w-full max-w-xs rounded-2xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-60">
          {pending ? "Confirmando…" : hayProblema ? "Ajustá el stock para continuar" : "Confirmar pedido"}
        </button>
        <p className="text-xs text-muted">El total se carga a tu cuenta corriente. Sin pago online por ahora.</p>
      </div>
    </div>
  );
}
