"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Search, ScanLine, Trash2, Plus, Minus, ShoppingCart } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { buscarProductos, buscarPorCodigo, crearVenta } from "@/app/(app)/pos/actions";

type OpenStore = { id: string; name: string; sessionId: string };
type Customer = { id: string; name: string; priceListId: string | null; priceListName: string | null };
type Method = { id: string; name: string; kind: string };
type CartItem = { variantId: string; name: string; label: string | null; quantity: number; unitPrice: number };
type Payment = { methodId: string; amount: string };

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function PosTerminal({
  openStores,
  customers,
  defaultCustomerId,
  paymentMethods,
}: {
  openStores: OpenStore[];
  customers: Customer[];
  defaultCustomerId: string | null;
  paymentMethods: Method[];
}) {
  const [storeId, setStoreId] = useState(openStores[0].id);
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof buscarProductos>>>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState("");
  const [payments, setPayments] = useState<Payment[]>([{ methodId: paymentMethods[0]?.id ?? "", amount: "" }]);
  const [pending, start] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const store = openStores.find((s) => s.id === storeId)!;
  const customer = customers.find((c) => c.id === customerId) ?? null;
  const priceListId = customer?.priceListId ?? null;

  const subtotal = cart.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const total = Math.max(0, subtotal - (Number(discount) || 0));
  const paid = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const remaining = Math.round((total - paid) * 100) / 100;

  function onSearch(v: string) {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setResults(v.trim().length >= 2 ? await buscarProductos(v, priceListId) : []);
    }, 250);
  }

  function addItem(variantId: string, name: string, label: string | null, price: number | null) {
    setCart((prev) => {
      const i = prev.findIndex((x) => x.variantId === variantId);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: next[i].quantity + 1 };
        return next;
      }
      return [...prev, { variantId, name, label, quantity: 1, unitPrice: price ?? 0 }];
    });
  }

  function setQty(variantId: string, qty: number) {
    setCart((prev) => prev.flatMap((x) => (x.variantId === variantId ? (qty <= 0 ? [] : [{ ...x, quantity: qty }]) : [x])));
  }
  function setPrice(variantId: string, price: number) {
    setCart((prev) => prev.map((x) => (x.variantId === variantId ? { ...x, unitPrice: price } : x)));
  }

  async function onScan(code: string) {
    const r = await buscarPorCodigo(code, priceListId);
    if (r.notFound) return toast.error(`Código ${code}: sin resultados`);
    addItem(r.variantId, r.name, r.label, r.price);
    toast.success(`${r.name} agregado`);
  }

  function confirmar() {
    if (cart.length === 0) return toast.error("El carrito está vacío.");
    if (remaining !== 0) return toast.error(remaining > 0 ? `Faltan cobrar ${formatMoney(remaining)}` : `Cobro excedido en ${formatMoney(-remaining)}`);

    start(async () => {
      const res = await crearVenta({
        storeId: store.id,
        cashSessionId: store.sessionId,
        customerId: customerId || null,
        priceListId,
        discount: Number(discount) || 0,
        items: cart.map((i) => ({ variantId: i.variantId, productName: i.name, variantLabel: i.label, quantity: i.quantity, unitPrice: i.unitPrice })),
        payments: payments.filter((p) => p.methodId && Number(p.amount) > 0).map((p) => ({ paymentMethodId: p.methodId, amount: Number(p.amount), surcharge: 0 })),
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success(`Venta #${res.number} registrada`);
      setCart([]);
      setDiscount("");
      setPayments([{ methodId: paymentMethods[0]?.id ?? "", amount: "" }]);
      setQuery("");
      setResults([]);
    });
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Punto de venta</h1>
        <div className="flex items-center gap-2">
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={`${input} w-auto`}>
            {openStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px]">
        {/* Izquierda: búsqueda + carrito */}
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input className={`${input} pl-9`} placeholder="Buscar producto…" value={query} onChange={(e) => onSearch(e.target.value)} />
              </div>
              <div className="relative sm:w-52">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input
                  className={`${input} pl-9`}
                  placeholder="Escanear código"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v) { onScan(v); (e.target as HTMLInputElement).value = ""; }
                    }
                  }}
                />
              </div>
            </div>

            {results.length > 0 && (
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                {results.map((r) => (
                  <div key={r.id} className="rounded-lg border border-line p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">{r.name}</span>
                      <span className="text-sm text-muted">{r.price != null ? formatMoney(r.price) : "sin precio"}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.variants.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => addItem(v.id, r.name, v.label, r.price)}
                          className="rounded-md border border-line-strong px-2 py-1 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
                        >
                          {v.label ?? "Agregar"}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Carrito */}
          <div className="rounded-xl border border-line bg-card">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <ShoppingCart className="h-4 w-4 text-muted" />
              <span className="text-sm font-medium text-ink">Carrito</span>
              <span className="ml-auto text-xs text-muted">{cart.length} ítem(s)</span>
            </div>
            {cart.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">Buscá o escaneá productos para agregarlos.</p>
            ) : (
              <div className="divide-y divide-line">
                {cart.map((i) => (
                  <div key={i.variantId} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{i.name}</div>
                      {i.label && <div className="text-xs text-muted">{i.label}</div>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setQty(i.variantId, i.quantity - 1)} className="rounded-md border border-line-strong p-1 text-muted hover:text-ink"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="w-7 text-center text-sm tabular-nums">{i.quantity}</span>
                      <button onClick={() => setQty(i.variantId, i.quantity + 1)} className="rounded-md border border-line-strong p-1 text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted">$</span>
                      <input type="number" min={0} value={i.unitPrice} onChange={(e) => setPrice(i.variantId, Number(e.target.value) || 0)} className={`${input} w-24 py-1`} />
                    </div>
                    <div className="w-24 text-right text-sm font-medium tabular-nums text-ink">{formatMoney(i.quantity * i.unitPrice)}</div>
                    <button onClick={() => setQty(i.variantId, 0)} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Derecha: cliente, total, cobro */}
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-card p-4">
            <label className="mb-1.5 block text-sm font-medium text-ink">Cliente</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={input}>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.priceListName ? ` · ${c.priceListName}` : ""}</option>)}
            </select>
          </div>

          <div className="rounded-xl border border-line bg-card p-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Subtotal</span>
              <span className="tabular-nums text-ink">{formatMoney(subtotal)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-muted">Descuento</span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted">$</span>
                <input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} className={`${input} w-24 py-1 text-right`} placeholder="0" />
              </div>
            </div>
            <div className="mt-3 flex justify-between border-t border-line pt-3">
              <span className="font-medium text-ink">Total</span>
              <span className="text-lg font-semibold tabular-nums text-ink">{formatMoney(total)}</span>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Cobro</span>
              <button
                onClick={() => setPayments((p) => { const n = [...p]; if (n[0]) n[0] = { ...n[0], amount: String(total) }; return n; })}
                className="text-xs text-accent hover:underline"
              >
                Efectivo exacto
              </button>
            </div>
            <div className="space-y-2">
              {payments.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select value={p.methodId} onChange={(e) => setPayments((arr) => arr.map((x, j) => j === idx ? { ...x, methodId: e.target.value } : x))} className={`${input} flex-1`}>
                    {paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="number" min={0} value={p.amount} onChange={(e) => setPayments((arr) => arr.map((x, j) => j === idx ? { ...x, amount: e.target.value } : x))} className={`${input} w-28`} placeholder="0" />
                  {payments.length > 1 && (
                    <button onClick={() => setPayments((arr) => arr.filter((_, j) => j !== idx))} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => setPayments((p) => [...p, { methodId: paymentMethods[0]?.id ?? "", amount: "" }])}
              className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-ink"
            >
              <Plus className="h-3.5 w-3.5" /> Agregar medio
            </button>

            <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm">
              <span className="text-muted">Restante</span>
              <span className={`font-medium tabular-nums ${remaining === 0 ? "text-ok" : "text-warn"}`}>{formatMoney(remaining)}</span>
            </div>
          </div>

          <button
            onClick={confirmar}
            disabled={pending || cart.length === 0}
            className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {pending ? "Registrando…" : `Confirmar venta · ${formatMoney(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
