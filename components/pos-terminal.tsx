"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Search, ScanLine, Trash2, Plus, Minus, ShoppingCart, Wallet, Unlock, Lock, ImageOff, Ticket, X, UserCheck, UserPlus, IdCard, Receipt, Gift, RefreshCw } from "lucide-react";
import { formatMoney, formatDateTime } from "@/lib/format";
import { buscarProductos, buscarPorCodigo, crearVenta, validarCupon, buscarClientePorDoc, crearClienteRapido } from "@/app/(app)/pos/actions";
import { abrirCaja, cerrarCaja } from "@/app/(app)/caja/actions";
import type { PosStore } from "@/app/(app)/pos/page";

type Method = { id: string; name: string; kind: string };
type Profile = { customerTypeId: string; name: string; priceListId: string | null };
type Customer = NonNullable<Awaited<ReturnType<typeof buscarClientePorDoc>>>;
type CartItem = { variantId: string; name: string; label: string | null; quantity: number; unitPrice: number; image: string | null };
type Payment = { methodId: string; amount: string };

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

function Thumb({ src, size = "h-10 w-10" }: { src: string | null; size?: string }) {
  if (!src)
    return <span className={`flex ${size} shrink-0 items-center justify-center rounded-md bg-canvas text-faint`}><ImageOff className="h-4 w-4" /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={`${size} shrink-0 rounded-md object-cover`} />;
}

type RetailForm = { name: string; apellido: string; doc: string; phone: string; email: string };
function toSnapshot(d: RetailForm) {
  const name = [d.name, d.apellido].filter(Boolean).join(" ").trim();
  const s = { name: name || undefined, doc: d.doc.trim() || undefined, phone: d.phone.trim() || undefined, email: d.email.trim() || undefined };
  return (s.name || s.doc || s.phone || s.email) ? s : null;
}

export function PosTerminal({
  stores,
  lockedToStore,
  isAdmin,
  retailPriceListId,
  wholesaleProfiles,
  paymentMethods,
}: {
  stores: PosStore[];
  lockedToStore: boolean;
  isAdmin: boolean;
  retailPriceListId: string | null;
  wholesaleProfiles: Profile[];
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
          {isAdmin && <Link href="/usuarios" className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover">Ir a Usuarios</Link>}
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
    ? <Terminal store={store} storeSelector={storeSelector} retailPriceListId={retailPriceListId} wholesaleProfiles={wholesaleProfiles} paymentMethods={paymentMethods} />
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
              toast.success("Caja abierta."); router.refresh();
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
          {diff !== null && <p className={`mt-1.5 text-xs ${diff === 0 ? "text-ok" : "text-warn"}`}>{diff === 0 ? "Cuadra exacto" : `Diferencia: ${formatMoney(diff)}`}</p>}
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
            toast.success("Caja cerrada."); router.refresh();
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
  retailPriceListId,
  wholesaleProfiles,
  paymentMethods,
}: {
  store: PosStore;
  storeSelector: React.ReactNode;
  retailPriceListId: string | null;
  wholesaleProfiles: Profile[];
  paymentMethods: Method[];
}) {
  const wholesale = store.isWholesale;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof buscarProductos>>>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [closing, setClosing] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<{ id: string; code: string; type: "percent" | "amount"; value: number; minAmount: number | null } | null>(null);
  const [retailData, setRetailData] = useState<RetailForm | null>(null);
  const [showRetail, setShowRetail] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [lastSale, setLastSale] = useState<{ id: string; number: number } | null>(null);
  const [pending, start] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const priceListId = wholesale ? (customer?.priceListId ?? null) : retailPriceListId;
  const creditAvailable = customer && customer.balance < 0 ? -customer.balance : 0;

  // Medios disponibles según el tipo de sucursal.
  const methods = paymentMethods.filter((m) => {
    if (m.kind === "saldo_favor") return wholesale && creditAvailable > 0;
    if (m.kind === "cuenta_corriente") return wholesale;
    return true;
  });
  const [payments, setPayments] = useState<Payment[]>([{ methodId: paymentMethods[0]?.id ?? "", amount: "" }]);

  const subtotal = cart.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const couponBelowMin = !wholesale && !!coupon && coupon.minAmount != null && subtotal < coupon.minAmount;
  const rawDiscount = !wholesale && coupon && !couponBelowMin
    ? (coupon.type === "percent" ? Math.round((subtotal * coupon.value) / 100) : coupon.value) : 0;
  const discount = Math.min(rawDiscount, subtotal);
  const total = Math.max(0, subtotal - discount);
  const paid = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const remaining = Math.round((total - paid) * 100) / 100;
  const overpay = remaining < 0 ? -remaining : 0;

  function onSearch(v: string) {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setResults(v.trim().length >= 2 ? await buscarProductos(v, priceListId) : []);
    }, 250);
  }
  function addItem(variantId: string, name: string, label: string | null, price: number | null, image: string | null) {
    if (wholesale && !customer) return toast.error("Identificá al cliente antes de cargar productos.");
    setCart((prev) => {
      const i = prev.findIndex((x) => x.variantId === variantId);
      if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], quantity: next[i].quantity + 1 }; return next; }
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
  }
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

  function confirmar() {
    if (cart.length === 0) return toast.error("El carrito está vacío.");
    if (wholesale && !customer) return toast.error("Identificá al cliente (mayorista).");
    if (couponBelowMin) return toast.error("El carrito ya no alcanza el mínimo del cupón.");
    if (remaining > 0) return toast.error(`Faltan cobrar ${formatMoney(remaining)}`);
    if (!wholesale && remaining < 0) return toast.error(`Cobro excedido en ${formatMoney(overpay)}`);

    // Mostrador: al cobrar se ofrece registrar los datos del cliente (opcional).
    if (!wholesale) { setCheckout(true); return; }
    finalizar(null);
  }

  function finalizar(snapshot: { name?: string; doc?: string; phone?: string; email?: string } | null) {
    start(async () => {
      const res = await crearVenta({
        storeId: store.id,
        cashSessionId: store.sessionId!,
        customerId: wholesale ? customer!.id : null,
        priceListId,
        couponId: !wholesale ? coupon?.id ?? null : null,
        customerData: !wholesale ? snapshot : null,
        items: cart.map((i) => ({ variantId: i.variantId, productName: i.name, variantLabel: i.label, quantity: i.quantity, unitPrice: i.unitPrice })),
        payments: payments.filter((p) => p.methodId && Number(p.amount) > 0).map((p) => ({ paymentMethodId: p.methodId, amount: Number(p.amount), surcharge: 0 })),
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success(`Venta #${res.number} registrada${overpay > 0 ? ` · $${overpay.toLocaleString("es-AR")} a favor` : ""}`);
      if (res.id && res.number != null) setLastSale({ id: res.id, number: res.number });
      setCart([]); setPayments([{ methodId: paymentMethods[0]?.id ?? "", amount: "" }]);
      setCoupon(null); setCouponCode(""); setRetailData(null); setCheckout(false); setQuery(""); setResults([]);
      if (wholesale) setCustomer(null);
    });
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Punto de venta</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${wholesale ? "bg-accent-soft text-accent" : "bg-canvas text-muted"}`}>
            {wholesale ? "Mayorista" : "Mostrador"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {storeSelector}
          <Link href="/cambios" className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">
            <RefreshCw className="h-4 w-4" /> Cambio
          </Link>
          <button onClick={() => setClosing((s) => !s)} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas">
            <Lock className="h-4 w-4" /> Cerrar caja
          </button>
        </div>
      </div>

      {closing && <CerrarCajaPanel store={store} onDone={() => setClosing(false)} />}

      {lastSale && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-ok/30 bg-ok-bg px-4 py-3">
          <Receipt className="h-4 w-4 text-ok" />
          <span className="text-sm font-medium text-ink">Venta #{lastSale.number} registrada</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => window.open(`/ventas/${lastSale.id}/ticket`, "_blank")} className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-canvas">
              <Receipt className="h-3.5 w-3.5" /> Imprimir ticket
            </button>
            <button onClick={() => window.open(`/ventas/${lastSale.id}/ticket?regalo=1`, "_blank")} className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-canvas">
              <Gift className="h-3.5 w-3.5" /> Ticket regalo
            </button>
            <button onClick={() => setLastSale(null)} className="rounded-md p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

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
                <input className={`${input} pl-9`} placeholder="Escanear código"
                  onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) { onScan(v); (e.target as HTMLInputElement).value = ""; } } }} />
              </div>
            </div>
            {wholesale && !customer && <p className="mt-2 text-xs text-warn">Identificá al cliente para ver los precios de su perfil.</p>}
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
                        <button key={v.id} onClick={() => addItem(v.id, r.name, v.label, r.price, r.image)} className="rounded-md border border-line-strong px-2 py-1 text-xs text-ink transition-colors hover:border-accent hover:text-accent">
                          {v.label ?? "Agregar"}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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

        {/* Derecha */}
        <div className="space-y-4">
          {wholesale
            ? <ClienteMayorista customer={customer} setCustomer={setCustomer} profiles={wholesaleProfiles} />
            : <ClienteMostrador data={retailData} onOpen={() => setShowRetail(true)} onClear={() => setRetailData(null)} />}

          <div className="rounded-xl border border-line bg-card p-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Subtotal</span>
              <span className="tabular-nums text-ink">{formatMoney(subtotal)}</span>
            </div>

            {!wholesale && (coupon ? (
              <div className="mt-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1.5 text-ok">
                    <Ticket className="h-3.5 w-3.5" /> {coupon.code}
                    <button onClick={() => { setCoupon(null); setCouponCode(""); }} className="text-faint hover:text-danger"><X className="h-3.5 w-3.5" /></button>
                  </span>
                  <span className="tabular-nums text-ok">−{formatMoney(discount)}</span>
                </div>
                {couponBelowMin && <p className="mt-1 text-xs text-warn">El carrito no alcanza el mínimo del cupón ({formatMoney(coupon.minAmount ?? 0)}).</p>}
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <Ticket className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                  <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") aplicarCupon(); }} placeholder="Cupón de descuento" className={`${input} py-1.5 pl-8 text-sm`} />
                </div>
                <button onClick={aplicarCupon} disabled={pending || !couponCode.trim()} className="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas disabled:opacity-50">Aplicar</button>
              </div>
            ))}

            <div className="mt-3 flex justify-between border-t border-line pt-3">
              <span className="font-medium text-ink">Total</span>
              <span className="text-lg font-semibold tabular-nums text-ink">{formatMoney(total)}</span>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Cobro</span>
              <button onClick={() => setPayments((p) => { const n = [...p]; if (n[0]) n[0] = { ...n[0], amount: String(total) }; return n; })} className="text-xs text-accent hover:underline">Efectivo exacto</button>
            </div>
            {wholesale && creditAvailable > 0 && <p className="mb-2 text-xs text-ok">Saldo a favor disponible: {formatMoney(creditAvailable)}</p>}
            <div className="space-y-2">
              {payments.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select value={p.methodId} onChange={(e) => setPayments((arr) => arr.map((x, j) => j === idx ? { ...x, methodId: e.target.value } : x))} className={`${input} flex-1`}>
                    {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="number" min={0} value={p.amount} onChange={(e) => setPayments((arr) => arr.map((x, j) => j === idx ? { ...x, amount: e.target.value } : x))} className={`${input} w-28`} placeholder="0" />
                  {payments.length > 1 && <button onClick={() => setPayments((arr) => arr.filter((_, j) => j !== idx))} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
            <button onClick={() => setPayments((p) => [...p, { methodId: methods[0]?.id ?? "", amount: "" }])} className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-ink">
              <Plus className="h-3.5 w-3.5" /> Agregar medio
            </button>
            <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm">
              <span className="text-muted">{overpay > 0 ? "Queda a favor" : "Restante"}</span>
              <span className={`font-medium tabular-nums ${remaining === 0 ? "text-ok" : overpay > 0 ? "text-ok" : "text-warn"}`}>
                {formatMoney(overpay > 0 ? overpay : remaining)}
              </span>
            </div>
          </div>

          <button onClick={confirmar} disabled={pending || cart.length === 0} className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
            {pending ? "Registrando…" : `Confirmar venta · ${formatMoney(total)}`}
          </button>
        </div>
      </div>

      {showRetail && <RetailDataModal mode="edit" data={retailData} onClose={() => setShowRetail(false)} onSave={(d) => { setRetailData(d); setShowRetail(false); }} />}
      {checkout && (
        <RetailDataModal
          mode="checkout"
          data={retailData}
          onClose={() => setCheckout(false)}
          onSkip={() => { setCheckout(false); finalizar(null); }}
          onSave={(d) => { setRetailData(d); setCheckout(false); finalizar(toSnapshot(d)); }}
        />
      )}
    </div>
  );
}

// ── Cliente mostrador (datos opcionales) ──────────────────────
function ClienteMostrador({ data, onOpen, onClear }: { data: { name: string; apellido: string; doc: string } | null; onOpen: () => void; onClear: () => void }) {
  const has = data && (data.name || data.apellido || data.doc);
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">Cliente</span>
        <button onClick={onOpen} className="text-xs text-accent hover:underline">{has ? "Editar datos" : "Datos (opcional)"}</button>
      </div>
      {has ? (
        <div className="mt-1.5 flex items-center justify-between text-sm">
          <span className="text-ink">{[data!.name, data!.apellido].filter(Boolean).join(" ") || "Sin nombre"}{data!.doc ? ` · ${data!.doc}` : ""}</span>
          <button onClick={onClear} className="text-faint hover:text-danger"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted">Consumidor final. Podés registrar datos para la factura (opcional).</p>
      )}
    </div>
  );
}

function RetailDataModal({ data, mode, onClose, onSave, onSkip }: {
  data: RetailForm | null;
  mode: "edit" | "checkout";
  onClose: () => void;
  onSave: (d: RetailForm) => void;
  onSkip?: () => void;
}) {
  const [f, setF] = useState<RetailForm>(data ?? { name: "", apellido: "", doc: "", phone: "", email: "" });
  const set = (k: keyof RetailForm, v: string) => setF((p) => ({ ...p, [k]: v }));
  const checkout = mode === "checkout";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-medium text-ink">Datos del cliente (opcional)</h2>
        <p className="mt-1 text-xs text-muted">{checkout ? "Registralos para enviarle la factura por mail cuando activemos facturación, o cobrá sin datos." : "Para poder enviar la factura por mail cuando activemos facturación. Todo es opcional."}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div><label className="mb-1 block text-xs font-medium text-muted">Nombre</label><input autoFocus className={input} value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div><label className="mb-1 block text-xs font-medium text-muted">Apellido</label><input className={input} value={f.apellido} onChange={(e) => set("apellido", e.target.value)} /></div>
          <div><label className="mb-1 block text-xs font-medium text-muted">DNI</label><input className={input} value={f.doc} onChange={(e) => set("doc", e.target.value)} /></div>
          <div><label className="mb-1 block text-xs font-medium text-muted">Teléfono</label><input className={input} value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="col-span-2"><label className="mb-1 block text-xs font-medium text-muted">Email</label><input type="email" className={input} value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          {checkout ? (
            <>
              <button onClick={onSkip} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cobrar sin datos</button>
              <button onClick={() => onSave(f)} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover">Guardar y cobrar</button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
              <button onClick={() => onSave(f)} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover">Guardar</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Cliente mayorista (DNI/CUIT obligatorio) ──────────────────
function ClienteMayorista({ customer, setCustomer, profiles }: { customer: Customer | null; setCustomer: (c: Customer | null) => void; profiles: Profile[] }) {
  const [doc, setDoc] = useState("");
  const [searched, setSearched] = useState(false);
  const [pending, start] = useTransition();
  const [nf, setNf] = useState({ name: "", profileTypeId: profiles[0]?.customerTypeId ?? "", docType: "DNI", email: "", phone: "" });

  function buscar() {
    const d = doc.trim();
    if (!d) return;
    start(async () => {
      const c = await buscarClientePorDoc(d);
      setSearched(true);
      if (c) { setCustomer(c); toast.success(`Cliente: ${c.name}`); }
      else { setNf((p) => ({ ...p, name: "" })); toast.message("Cliente nuevo: completá los datos."); }
    });
  }
  function crear() {
    if (!nf.name.trim()) return toast.error("Ingresá el nombre.");
    if (!nf.profileTypeId) return toast.error("Elegí un perfil.");
    start(async () => {
      const r = await crearClienteRapido({ docType: nf.docType, docNumber: doc.trim(), name: nf.name, customerTypeId: nf.profileTypeId, email: nf.email, phone: nf.phone });
      if (!r.ok) { toast.error(r.error); return; }
      setCustomer(r.customer); toast.success("Cliente creado.");
    });
  }

  if (customer) {
    const bal = customer.balance;
    return (
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-ink">{customer.name}</span>
          <button onClick={() => { setCustomer(null); setDoc(""); setSearched(false); }} className="ml-auto text-xs text-accent hover:underline">Cambiar</button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{customer.docType ?? "Doc"} {customer.docNumber}</span>
          {customer.profileName && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">{customer.profileName}</span>}
          <span className={bal > 0 ? "text-danger" : bal < 0 ? "text-ok" : ""}>
            {bal > 0 ? `Debe ${formatMoney(bal)}` : bal < 0 ? `A favor ${formatMoney(-bal)}` : "Sin saldo"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <IdCard className="h-4 w-4 text-muted" />
        <span className="text-sm font-medium text-ink">Cliente mayorista</span>
        <span className="ml-auto text-xs text-warn">DNI/CUIT obligatorio</span>
      </div>
      <div className="flex items-center gap-2">
        <input value={doc} onChange={(e) => { setDoc(e.target.value); setSearched(false); }} onKeyDown={(e) => { if (e.key === "Enter") buscar(); }} placeholder="DNI o CUIT" className={input} />
        <button onClick={buscar} disabled={pending || !doc.trim()} className="shrink-0 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50">Buscar</button>
      </div>

      {searched && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="flex items-center gap-1.5 text-xs text-muted"><UserPlus className="h-3.5 w-3.5" /> Cliente nuevo</div>
          <input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="Nombre / Razón social" className={input} />
          <div className="flex gap-2">
            <select value={nf.docType} onChange={(e) => setNf({ ...nf, docType: e.target.value })} className={`${input} w-24`}>
              <option value="DNI">DNI</option>
              <option value="CUIT">CUIT</option>
              <option value="CUIL">CUIL</option>
            </select>
            <select value={nf.profileTypeId} onChange={(e) => setNf({ ...nf, profileTypeId: e.target.value })} className={`${input} flex-1`}>
              {profiles.map((p) => <option key={p.customerTypeId} value={p.customerTypeId}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <input value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="Email (opc.)" className={input} />
            <input value={nf.phone} onChange={(e) => setNf({ ...nf, phone: e.target.value })} placeholder="Tel. (opc.)" className={input} />
          </div>
          <button onClick={crear} disabled={pending} className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">Crear y usar</button>
        </div>
      )}
    </div>
  );
}
