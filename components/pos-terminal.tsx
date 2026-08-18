"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Search, ScanLine, Trash2, Plus, Minus, ShoppingCart, Wallet, Unlock, Lock, ImageOff, Ticket, X } from "lucide-react";
import { formatMoney, formatDateTime } from "@/lib/format";
import { buscarProductos, buscarPorCodigo, crearVenta, validarCupon } from "@/app/(app)/pos/actions";
import { abrirCaja, cerrarCaja } from "@/app/(app)/caja/actions";
import type { PosStore } from "@/app/(app)/pos/page";

type Customer = { id: string; name: string; priceListId: string | null; priceListName: string | null };
type Method = { id: string; name: string; kind: string };
type CartItem = { variantId: string; name: string; label: string | null; quantity: number; unitPrice: number; image: string | null };
type Payment = { methodId: string; amount: string };

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

function Thumb({ src, size = "h-10 w-10" }: { src: string | null; size?: string }) {
  if (!src)
    return (
      <span className={`flex ${size} shrink-0 items-center justify-center rounded-md bg-canvas text-faint`}>
        <ImageOff className="h-4 w-4" />
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={`${size} shrink-0 rounded-md object-cover`} />;
}

export function PosTerminal({
  stores,
  lockedToStore,
  isAdmin,
  customers,
  defaultCustomerId,
  paymentMethods,
}: {
  stores: PosStore[];
  lockedToStore: boolean;
  isAdmin: boolean;
  customers: Customer[];
  defaultCustomerId: string | null;
  paymentMethods: Method[];
}) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const store = stores.find((s) => s.id === storeId) ?? stores[0] ?? null;

  if (!store) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Punto de venta</h1>
        <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-card py-14 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><Wallet className="h-5 w-5" /></span>
          <p className="mt-3 font-medium text-ink">No tenés una sucursal asignada</p>
          <p className="mt-1 text-sm text-muted">Pedile a un administrador que te asigne una sucursal para poder vender.</p>
          {isAdmin && (
            <Link href="/usuarios" className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover">Ir a Usuarios</Link>
          )}
        </div>
      </div>
    );
  }

  const storeSelector = !lockedToStore && stores.length > 1 && (
    <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={`${input} w-auto`}>
      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );

  return store.sessionId
    ? <Terminal store={store} storeSelector={storeSelector} customers={customers} defaultCustomerId={defaultCustomerId} paymentMethods={paymentMethods} />
    : <AbrirCaja store={store} storeSelector={storeSelector} />;
}

// ── Apertura de caja embebida ─────────────────────────────────
function AbrirCaja({ store, storeSelector }: { store: PosStore; storeSelector: React.ReactNode }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Punto de venta</h1>
        {storeSelector}
      </div>
      <div className="rounded-xl border border-line bg-card p-6">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted" />
          <h2 className="font-medium text-ink">{store.name}</h2>
          <span className="ml-auto rounded-full bg-canvas px-2.5 py-0.5 text-xs font-medium text-muted">Caja cerrada</span>
        </div>
        <p className="mt-3 text-sm text-muted">Abrí el turno de caja para empezar a vender. Ingresá el efectivo con el que arrancás.</p>
        <div className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-ink">Fondo inicial</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">$</span>
              <input type="number" min={0} className={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </div>
          </div>
          <button
            disabled={pending}
            onClick={() => start(async () => {
              const r = await abrirCaja(store.id, Number(amount) || 0);
              if (r.error) { toast.error(r.error); return; }
              toast.success("Caja abierta.");
              router.refresh();
            })}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
          >
            <Unlock className="h-4 w-4" /> {pending ? "Abriendo…" : "Abrir caja"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Panel de cierre de caja ───────────────────────────────────
function CerrarCajaPanel({ store, onDone }: { store: PosStore; onDone: () => void }) {
  const router = useRouter();
  const sum = store.summary;
  const [declared, setDeclared] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const diff = declared !== "" && sum ? Number(declared) - sum.expectedCash : null;

  return (
    <div className="mb-5 rounded-xl border border-line bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted" />
        <h2 className="font-medium text-ink">Cerrar caja · {store.name}</h2>
        <span className="ml-auto text-xs text-muted">Abierta {store.openedAt ? formatDateTime(store.openedAt) : ""}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Fondo" value={formatMoney(store.openingAmount)} />
        <Tile label="Vendido" value={formatMoney(sum?.sold ?? 0)} />
        <Tile label="Efectivo cobrado" value={formatMoney(sum?.cash ?? 0)} />
        <Tile label="Efectivo esperado" value={formatMoney(sum?.expectedCash ?? 0)} accent />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Efectivo contado</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">$</span>
            <input type="number" min={0} className={input} value={declared} onChange={(e) => setDeclared(e.target.value)} placeholder="0" />
          </div>
          {diff !== null && (
            <p className={`mt-1.5 text-xs ${diff === 0 ? "text-ok" : "text-warn"}`}>{diff === 0 ? "Cuadra exacto" : `Diferencia: ${formatMoney(diff)}`}</p>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Notas (opcional)</label>
          <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones del cierre" />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-3">
        <button onClick={onDone} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
        <button
          disabled={pending || declared === ""}
          onClick={() => start(async () => {
            const r = await cerrarCaja(store.sessionId!, Number(declared) || 0, notes);
            if (r.error) { toast.error(r.error); return; }
            toast.success("Caja cerrada.");
            router.refresh();
          })}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          <Lock className="h-4 w-4" /> {pending ? "Cerrando…" : "Cerrar caja"}
        </button>
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-canvas px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
    </div>
  );
}

// ── Terminal de venta ─────────────────────────────────────────
function Terminal({
  store,
  storeSelector,
  customers,
  defaultCustomerId,
  paymentMethods,
}: {
  store: PosStore;
  storeSelector: React.ReactNode;
  customers: Customer[];
  defaultCustomerId: string | null;
  paymentMethods: Method[];
}) {
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof buscarProductos>>>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([{ methodId: paymentMethods[0]?.id ?? "", amount: "" }]);
  const [closing, setClosing] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<{ id: string; code: string; type: "percent" | "amount"; value: number; minAmount: number | null } | null>(null);
  const [pending, start] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const priceListId = customer?.priceListId ?? null;

  const subtotal = cart.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  // El descuento se recalcula en vivo desde el tipo/valor del cupón (así no se
  // desincroniza con el carrito). El RPC lo vuelve a calcular al confirmar.
  const couponBelowMin = !!coupon && coupon.minAmount != null && subtotal < coupon.minAmount;
  const rawDiscount = coupon && !couponBelowMin
    ? (coupon.type === "percent" ? Math.round((subtotal * coupon.value) / 100) : coupon.value)
    : 0;
  const discount = Math.min(rawDiscount, subtotal);
  const total = Math.max(0, subtotal - discount);
  const paid = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const remaining = Math.round((total - paid) * 100) / 100;

  function aplicarCupon() {
    const code = couponCode.trim();
    if (!code) return;
    if (subtotal <= 0) return toast.error("Agregá productos antes del cupón.");
    start(async () => {
      const r = await validarCupon(code, subtotal);
      if (!r.ok) { toast.error(r.error); return; }
      setCoupon({ id: r.couponId, code: code.toUpperCase(), type: r.discountType, value: r.discountValue, minAmount: r.minAmount });
      toast.success(`Cupón aplicado: −${formatMoney(r.discount)}`);
    });
  }
  function quitarCupon() {
    setCoupon(null);
    setCouponCode("");
  }

  function onSearch(v: string) {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setResults(v.trim().length >= 2 ? await buscarProductos(v, priceListId) : []);
    }, 250);
  }

  function addItem(variantId: string, name: string, label: string | null, price: number | null, image: string | null) {
    setCart((prev) => {
      const i = prev.findIndex((x) => x.variantId === variantId);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: next[i].quantity + 1 };
        return next;
      }
      return [...prev, { variantId, name, label, quantity: 1, unitPrice: price ?? 0, image }];
    });
  }
  function setQty(variantId: string, qty: number) {
    setCart((prev) => prev.flatMap((x) => (x.variantId === variantId ? (qty <= 0 ? [] : [{ ...x, quantity: qty }]) : [x])));
  }

  async function onScan(code: string) {
    const r = await buscarPorCodigo(code, priceListId);
    if (r.notFound) return toast.error(`Código ${code}: sin resultados`);
    addItem(r.variantId, r.name, r.label, r.price, r.image);
    toast.success(`${r.name} agregado`);
  }

  function confirmar() {
    if (cart.length === 0) return toast.error("El carrito está vacío.");
    if (couponBelowMin) return toast.error("El carrito ya no alcanza el mínimo del cupón. Quitalo o agregá productos.");
    if (remaining !== 0) return toast.error(remaining > 0 ? `Faltan cobrar ${formatMoney(remaining)}` : `Cobro excedido en ${formatMoney(-remaining)}`);

    start(async () => {
      const res = await crearVenta({
        storeId: store.id,
        cashSessionId: store.sessionId!,
        customerId: customerId || null,
        priceListId,
        couponId: coupon?.id ?? null,
        items: cart.map((i) => ({ variantId: i.variantId, productName: i.name, variantLabel: i.label, quantity: i.quantity, unitPrice: i.unitPrice })),
        payments: payments.filter((p) => p.methodId && Number(p.amount) > 0).map((p) => ({ paymentMethodId: p.methodId, amount: Number(p.amount), surcharge: 0 })),
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success(`Venta #${res.number} registrada`);
      setCart([]);
      setPayments([{ methodId: paymentMethods[0]?.id ?? "", amount: "" }]);
      setCoupon(null);
      setCouponCode("");
      setQuery("");
      setResults([]);
    });
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Punto de venta</h1>
        <div className="flex items-center gap-2">
          {storeSelector}
          <button
            onClick={() => setClosing((s) => !s)}
            className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas"
          >
            <Lock className="h-4 w-4" /> Cerrar caja
          </button>
        </div>
      </div>

      {closing && <CerrarCajaPanel store={store} onDone={() => setClosing(false)} />}

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
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {results.map((r) => (
                  <div key={r.id} className="rounded-lg border border-line p-2.5">
                    <div className="flex items-center gap-3">
                      <Thumb src={r.image} />
                      <span className="flex-1 text-sm font-medium text-ink">{r.name}</span>
                      <span className="text-sm text-muted">{r.price != null ? formatMoney(r.price) : "sin precio"}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
                      {r.variants.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => addItem(v.id, r.name, v.label, r.price, r.image)}
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
                    <Thumb src={i.image} size="h-9 w-9" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{i.name}</div>
                      {i.label && <div className="text-xs text-muted">{i.label}</div>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setQty(i.variantId, i.quantity - 1)} className="rounded-md border border-line-strong p-1 text-muted hover:text-ink"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="w-7 text-center text-sm tabular-nums">{i.quantity}</span>
                      <button onClick={() => setQty(i.variantId, i.quantity + 1)} className="rounded-md border border-line-strong p-1 text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="w-20 text-right text-sm tabular-nums text-muted">{formatMoney(i.unitPrice)}</div>
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

            {/* Cupón */}
            {coupon ? (
              <div className="mt-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1.5 text-ok">
                    <Ticket className="h-3.5 w-3.5" /> {coupon.code}
                    <button onClick={quitarCupon} className="text-faint hover:text-danger" title="Quitar cupón"><X className="h-3.5 w-3.5" /></button>
                  </span>
                  <span className="tabular-nums text-ok">−{formatMoney(discount)}</span>
                </div>
                {couponBelowMin && (
                  <p className="mt-1 text-xs text-warn">El carrito no alcanza el mínimo del cupón ({formatMoney(coupon.minAmount ?? 0)}).</p>
                )}
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <Ticket className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                  <input
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") aplicarCupon(); }}
                    placeholder="Cupón de descuento"
                    className={`${input} py-1.5 pl-8 text-sm`}
                  />
                </div>
                <button onClick={aplicarCupon} disabled={pending || !couponCode.trim()} className="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas disabled:opacity-50">Aplicar</button>
              </div>
            )}

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
            <button onClick={() => setPayments((p) => [...p, { methodId: paymentMethods[0]?.id ?? "", amount: "" }])} className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-ink">
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
