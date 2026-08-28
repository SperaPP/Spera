"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Search, ScanLine, Trash2, Plus, Minus, ShoppingCart, Wallet, Unlock, Lock, ImageOff, Ticket, X, UserCheck, UserPlus, IdCard, Receipt, Gift, RefreshCw } from "lucide-react";
import { formatMoney, formatDateTime } from "@/lib/format";
import { listarProductosPOS, buscarPorCodigo, crearVenta, validarCupon, buscarClientePorDoc, buscarClientesSimilares, crearClienteRapido } from "@/app/(app)/pos/actions";

type GridProduct = Awaited<ReturnType<typeof listarProductosPOS>>[number];
import { abrirCaja, cerrarCaja } from "@/app/(app)/caja/actions";
import { NuevoCambioForm } from "@/components/nuevo-cambio-form";
import type { PosStore } from "@/app/(app)/pos/page";

type Method = { id: string; name: string; kind: string };
type Profile = { customerTypeId: string; name: string; priceListId: string | null };
type Customer = NonNullable<Awaited<ReturnType<typeof buscarClientePorDoc>>>;
type CartItem = { variantId: string; name: string; label: string | null; quantity: number; unitPrice: number; image: string | null; stock: number };
type Payment = { methodId: string; amount: string };

const inputBase =
  "rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15";
const input = `w-full ${inputBase}`;
const card = "rounded-2xl border border-line bg-card shadow-sm";

function Thumb({ src, size = "h-10 w-10" }: { src: string | null; size?: string }) {
  if (!src)
    return <span className={`flex ${size} shrink-0 items-center justify-center rounded-md bg-canvas text-faint`}><ImageOff className="h-4 w-4" /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" decoding="async" className={`${size} shrink-0 rounded-md object-cover`} />;
}

export function PosTerminal({
  stores,
  lockedToStore,
  isAdmin,
  retailPriceListId,
  wholesaleProfiles,
  retailProfiles,
  walkInCustomer,
  paymentMethods,
}: {
  stores: PosStore[];
  lockedToStore: boolean;
  isAdmin: boolean;
  retailPriceListId: string | null;
  wholesaleProfiles: Profile[];
  retailProfiles: Profile[];
  walkInCustomer: Customer | null;
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
    <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={`${inputBase} w-auto shrink-0`}>
      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );

  if (store.sessionId && store.stale) return <CajaVieja store={store} storeSelector={storeSelector} />;
  return store.sessionId
    ? <Terminal store={store} storeSelector={storeSelector} retailPriceListId={retailPriceListId} wholesaleProfiles={wholesaleProfiles} retailProfiles={retailProfiles} walkInCustomer={walkInCustomer} paymentMethods={paymentMethods} />
    : <AbrirCaja store={store} storeSelector={storeSelector} />;
}

// ── Caja de un día anterior: hay que cerrarla antes de vender ──
function CajaVieja({ store, storeSelector }: { store: PosStore; storeSelector: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Punto de venta</h1>
        {storeSelector}
      </div>
      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger-bg px-4 py-3">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div>
          <p className="text-sm font-semibold text-ink">La caja del {store.openedAt ? formatDateTime(store.openedAt) : "día anterior"} no se cerró</p>
          <p className="mt-0.5 text-sm text-muted">Cerrala para poder abrir la caja de hoy y vender. No se puede vender con una caja de otro día.</p>
        </div>
      </div>
      <CerrarCajaPanel store={store} onDone={() => {}} />
    </div>
  );
}

// ── Apertura de caja embebida ─────────────────────────────────
function AbrirCaja({ store, storeSelector }: { store: PosStore; storeSelector: React.ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Si ya hay una caja titular abierta, ésta sería de apoyo (solo vende).
  const apoyo = store.titularOpen;
  // Sin titular abierta y sin permiso de titular → no puede abrir todavía.
  const blocked = !store.titularOpen && !store.iAmTitular;

  if (blocked) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Punto de venta</h1>
          {storeSelector}
        </div>
        <div className="rounded-2xl border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted" />
            <h2 className="font-medium text-ink">{store.name}</h2>
            <span className="ml-auto rounded-full bg-canvas px-2.5 py-0.5 text-xs font-medium text-muted">Sin caja abierta</span>
          </div>
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
            <div>
              <p className="text-sm font-semibold text-ink">Todavía no hay una caja titular abierta</p>
              <p className="mt-0.5 text-sm text-muted">Esperá a que un cajero titular abra la caja del local. Recién ahí vas a poder abrir una caja de apoyo para vender.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Punto de venta</h1>
        {storeSelector}
      </div>
      <div className="rounded-2xl border border-line bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted" />
          <h2 className="font-medium text-ink">{store.name}</h2>
          <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${apoyo ? "bg-accent-soft text-accent" : "bg-canvas text-muted"}`}>
            {apoyo ? "Caja de apoyo" : "Caja titular"}
          </span>
        </div>

        {apoyo ? (
          <>
            <p className="mt-3 text-sm text-muted">Ya hay una caja abierta en el local. Abrís una <span className="font-medium text-ink">caja de apoyo</span>: solo vendés. La caja titular maneja la caja chica, el cierre y el reparto a la caja fuerte. Tu efectivo se rinde a la caja titular.</p>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
              <span className="text-sm text-muted">Fondo</span>
              <span className="text-lg font-semibold tabular-nums text-ink">Sin fondo</span>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted">Sos la <span className="font-medium text-ink">caja titular</span> del local. Arrancás con la caja chica que quedó del último cierre; al cerrar repartís cuánto queda en caja chica y cuánto pasa a la caja fuerte.</p>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-canvas px-4 py-3">
              <span className="text-sm text-muted">Caja chica (fondo)</span>
              <span className="text-lg font-semibold tabular-nums text-ink">{formatMoney(store.pettyCash)}</span>
            </div>
            {store.pettyCash === 0 && <p className="mt-2 text-xs text-muted">El local no tiene caja chica cargada. Si es el primer día, pedile a administración que cargue el fondo inicial con un ajuste de caja.</p>}
          </>
        )}

        <button
          disabled={pending}
          onClick={() => start(async () => {
            const r = await abrirCaja(store.id);
            if (r.error) { toast.error(r.error); return; }
            toast.success(apoyo ? "Caja de apoyo abierta." : "Caja abierta."); router.refresh();
          })}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          <Unlock className="h-4 w-4" /> {pending ? "Abriendo…" : apoyo ? "Abrir caja de apoyo" : "Abrir caja"}
        </button>
      </div>
    </div>
  );
}

// ── Panel de cierre de caja ───────────────────────────────────
function CerrarCajaPanel({ store, onDone }: { store: PosStore; onDone: () => void }) {
  const router = useRouter();
  const sum = store.summary;
  const apoyo = store.role === "apoyo";
  const [declared, setDeclared] = useState("");
  const [kept, setKept] = useState(String(store.openingAmount));
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  const declaredN = Number(declared) || 0;
  const keptN = Number(kept) || 0;
  const diff = declared !== "" && sum ? declaredN - sum.expectedCash : null;
  const toSafe = Math.max(0, declaredN - keptN);
  const keptTooBig = declared !== "" && keptN > declaredN;
  const blockedByApoyos = !apoyo && store.openApoyoCount > 0;

  return (
    <div className="mb-5 rounded-2xl border border-line bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted" />
        <h2 className="font-medium text-ink">{apoyo ? "Cerrar caja de apoyo" : "Cerrar caja"} · {store.name}</h2>
        <span className="ml-auto text-xs text-muted">Abierta {store.openedAt ? formatDateTime(store.openedAt) : ""}</span>
      </div>

      {apoyo && (
        <p className="mb-3 text-xs text-muted">Sos caja de apoyo: contá tu efectivo y entregáselo a la caja titular. El reparto a caja chica/fuerte lo hace la titular al cerrar.</p>
      )}
      {blockedByApoyos && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-bg px-3 py-2 text-sm text-ink">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <span>Hay {store.openApoyoCount} caja{store.openApoyoCount > 1 ? "s" : ""} de apoyo abierta{store.openApoyoCount > 1 ? "s" : ""}. Como titular, cerrá primero las de apoyo para poder cerrar y repartir.</span>
        </div>
      )}

      <div className={`grid grid-cols-2 gap-3 ${apoyo ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}>
        {!apoyo && <Tile label="Fondo (caja chica)" value={formatMoney(store.openingAmount)} />}
        <Tile label="Vendido" value={formatMoney(sum?.sold ?? 0)} />
        <Tile label="Efectivo cobrado" value={formatMoney(sum?.cash ?? 0)} />
        <Tile label="Efectivo esperado" value={formatMoney(sum?.expectedCash ?? 0)} accent />
      </div>

      {apoyo ? (
        <div className="mt-4 border-t border-line pt-4">
          <label className="mb-1.5 block text-sm font-medium text-ink">Efectivo contado</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">$</span>
            <input type="number" min={0} className={input} value={declared} onChange={(e) => setDeclared(e.target.value)} placeholder="0" />
          </div>
          {diff !== null && <p className={`mt-1.5 text-xs ${diff === 0 ? "text-ok" : "text-warn"}`}>{diff === 0 ? "Cuadra exacto" : `Diferencia con lo esperado: ${formatMoney(diff)}`}</p>}
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Efectivo contado (todo el local)</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">$</span>
                <input type="number" min={0} className={input} value={declared} onChange={(e) => setDeclared(e.target.value)} placeholder="0" />
              </div>
              {diff !== null && <p className={`mt-1.5 text-xs ${diff === 0 ? "text-ok" : "text-warn"}`}>{diff === 0 ? "Cuadra exacto" : `Diferencia con lo esperado: ${formatMoney(diff)}`}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Dejo en caja chica</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">$</span>
                <input type="number" min={0} className={input} value={kept} onChange={(e) => setKept(e.target.value)} placeholder="0" />
              </div>
              {keptTooBig && <p className="mt-1.5 text-xs text-danger">No podés dejar más de lo contado.</p>}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas px-4 py-3 text-sm">
            <span className="text-muted">A caja fuerte: <span className="font-semibold text-ink">{formatMoney(toSafe)}</span></span>
            <span className="text-muted">Caja fuerte del local: {formatMoney(store.safeBalance)} → <span className="font-semibold text-accent">{formatMoney(store.safeBalance + toSafe)}</span></span>
          </div>
        </>
      )}

      <div className="mt-3">
        <label className="mb-1.5 block text-sm font-medium text-ink">Notas (opcional)</label>
        <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones del cierre" />
      </div>

      <div className="mt-4 flex justify-end gap-3">
        <button onClick={onDone} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
        <button
          disabled={pending || declared === "" || (!apoyo && (keptTooBig || blockedByApoyos))}
          onClick={() => start(async () => {
            const r = await cerrarCaja(store.sessionId!, declaredN, apoyo ? 0 : keptN, notes);
            if (r.error) { toast.error(r.error); return; }
            toast.success(apoyo ? "Caja de apoyo cerrada." : `Caja cerrada. ${formatMoney(toSafe)} a caja fuerte.`); router.refresh();
          })}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
        >
          <Lock className="h-4 w-4" /> {pending ? "Cerrando…" : apoyo ? "Cerrar caja de apoyo" : "Cerrar caja"}
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
  retailProfiles,
  walkInCustomer,
  paymentMethods,
}: {
  store: PosStore;
  storeSelector: React.ReactNode;
  retailPriceListId: string | null;
  wholesaleProfiles: Profile[];
  retailProfiles: Profile[];
  walkInCustomer: Customer | null;
  paymentMethods: Method[];
}) {
  const router = useRouter();
  const wholesale = store.isWholesale;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GridProduct[]>([]);
  const [variantPick, setVariantPick] = useState<GridProduct | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [closing, setClosing] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<{ id: string; code: string; type: "percent" | "amount"; value: number; minAmount: number | null } | null>(null);
  const [lastSale, setLastSale] = useState<{ id: string; number: number } | null>(null);
  const [mode, setMode] = useState<"vender" | "cambio">("vender");
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

  // Grilla de productos: carga por defecto (con foto) y filtra al buscar.
  useEffect(() => {
    listarProductosPOS(query, priceListId, store.warehouseId).then(setResults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceListId]);

  function onSearch(v: string) {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setResults(await listarProductosPOS(v, priceListId, store.warehouseId));
    }, 250);
  }
  function addItem(variantId: string, name: string, label: string | null, price: number | null, image: string | null, stock: number) {
    if (!customer) return toast.error("Identificá al cliente antes de cargar productos.");
    const tag = `${name}${label ? ` ${label}` : ""}`;
    if (stock <= 0) return toast.error(`${tag}: sin stock`);
    const existing = cart.find((x) => x.variantId === variantId);
    if (existing && existing.quantity >= stock) return toast.error(`${tag}: no hay más stock (máx ${stock})`);
    setCart((prev) => {
      const i = prev.findIndex((x) => x.variantId === variantId);
      if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], quantity: Math.min(next[i].quantity + 1, stock), stock }; return next; }
      return [...prev, { variantId, name, label, quantity: 1, unitPrice: price ?? 0, image, stock }];
    });
  }
  function onTile(p: GridProduct) {
    if (!customer) return toast.error("Identificá al cliente antes de cargar productos.");
    if (p.stock <= 0) return toast.error(`${p.name}: sin stock`);
    if (p.variants.length <= 1) {
      const v = p.variants[0];
      if (!v) return toast.error("El producto no tiene variantes.");
      addItem(v.id, p.name, v.label, p.price, p.image, v.stock);
    } else {
      setVariantPick(p);
    }
  }
  function setQty(variantId: string, qty: number) {
    setCart((prev) => prev.flatMap((x) => (x.variantId === variantId ? (qty <= 0 ? [] : [{ ...x, quantity: Math.min(qty, x.stock) }]) : [x])));
  }
  async function onScan(code: string) {
    const r = await buscarPorCodigo(code, priceListId, store.warehouseId);
    if (r.notFound) return toast.error(`Código ${code}: sin resultados`);
    addItem(r.variantId, r.name, r.label, r.price, r.image, r.stock);
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

  // Aplica el saldo a favor del cliente para cubrir lo que falta (hasta el disponible).
  function aplicarSaldoAFavor() {
    const m = methods.find((x) => x.kind === "saldo_favor");
    if (!m || creditAvailable <= 0) return;
    const isFavor = (methodId: string) => methods.find((x) => x.id === methodId)?.kind === "saldo_favor";
    const others = payments.filter((p) => !isFavor(p.methodId));
    const paidExcl = others.reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const apply = Math.min(creditAvailable, Math.max(0, total - paidExcl));
    if (apply <= 0) { toast.message("No hace falta usar saldo a favor: el pago ya cubre el total."); return; }
    setPayments([...others, { methodId: m.id, amount: String(apply) }]);
  }

  // Fía el saldo restante: lo carga con el medio "Cuenta corriente" (suma DEUDA
  // al cliente en create_sale, no saldo a favor).
  function aCuentaCorriente() {
    const m = methods.find((x) => x.kind === "cuenta_corriente");
    if (!m) return toast.error("No hay medio de Cuenta corriente configurado.");
    const isCC = (methodId: string) => methods.find((x) => x.id === methodId)?.kind === "cuenta_corriente";
    const others = payments.filter((p) => !isCC(p.methodId));
    const paidExcl = others.reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const rest = Math.round((total - paidExcl) * 100) / 100;
    if (rest <= 0) { toast.message("El pago ya cubre el total; no queda saldo para fiar."); return; }
    setPayments([...others, { methodId: m.id, amount: String(rest) }]);
  }

  function confirmar() {
    if (cart.length === 0) return toast.error("El carrito está vacío.");
    if (!customer) return toast.error("Identificá al cliente antes de cobrar.");
    if (couponBelowMin) return toast.error("El carrito ya no alcanza el mínimo del cupón.");
    if (remaining > 0) return toast.error(`Faltan cobrar ${formatMoney(remaining)}`);
    if (!wholesale && remaining < 0) return toast.error(`Cobro excedido en ${formatMoney(overpay)}`);
    finalizar();
  }

  function finalizar() {
    start(async () => {
      // Tanto mostrador como mayorista identifican al cliente: la venta queda
      // vinculada al customer_id (ya no se guarda un snapshot suelto).
      const res = await crearVenta({
        storeId: store.id,
        cashSessionId: store.sessionId!,
        customerId: customer!.id,
        priceListId,
        couponId: !wholesale ? coupon?.id ?? null : null,
        customerData: null,
        items: cart.map((i) => ({ variantId: i.variantId, productName: i.name, variantLabel: i.label, quantity: i.quantity, unitPrice: i.unitPrice })),
        payments: payments.filter((p) => p.methodId && Number(p.amount) > 0).map((p) => ({ paymentMethodId: p.methodId, amount: Number(p.amount), surcharge: 0 })),
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success(`Venta #${res.number} registrada${overpay > 0 ? ` · $${overpay.toLocaleString("es-AR")} a favor` : ""}`);
      if (res.id && res.number != null) setLastSale({ id: res.id, number: res.number });
      setCart([]); setPayments([{ methodId: paymentMethods[0]?.id ?? "", amount: "" }]);
      setCoupon(null); setCouponCode(""); setQuery(""); setResults([]);
      setCustomer(null);
      router.refresh(); // actualiza el arqueo de caja del POS con la venta recién hecha
    });
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Punto de venta</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${wholesale ? "bg-accent-soft text-accent" : "bg-ink/[0.06] text-muted"}`}>
            {wholesale ? "Mayorista" : "Mostrador"}
          </span>
          {store.role === "apoyo" && <span className="rounded-full bg-warn-bg px-3 py-1 text-xs font-semibold text-warn">Caja de apoyo</span>}
        </div>
        <div className="flex items-center gap-2">
          {storeSelector}
          <div className="flex shrink-0 overflow-hidden rounded-xl border border-line-strong text-sm font-medium shadow-sm">
            <button onClick={() => setMode("vender")} className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${mode === "vender" ? "bg-accent text-accent-fg" : "bg-card text-ink hover:bg-canvas"}`}>
              <ShoppingCart className="h-4 w-4 shrink-0" /> Vender
            </button>
            <button onClick={() => setMode("cambio")} className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${mode === "cambio" ? "bg-accent text-accent-fg" : "bg-card text-ink hover:bg-canvas"}`}>
              <RefreshCw className="h-4 w-4 shrink-0" /> Cambio
            </button>
          </div>
          <button onClick={() => setClosing((s) => !s)} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-line-strong bg-card px-3 py-2 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-canvas">
            <Lock className="h-4 w-4 shrink-0" /> Cerrar caja
          </button>
        </div>
      </div>

      {closing && <CerrarCajaPanel store={store} onDone={() => setClosing(false)} />}

      {mode === "vender" && lastSale && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-ok/30 bg-ok-bg px-4 py-3 shadow-sm">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ok/15 text-ok"><Receipt className="h-4 w-4" /></span>
          <span className="text-sm font-semibold text-ink">Venta #{lastSale.number} registrada</span>
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

      {mode === "cambio" && (
        <NuevoCambioForm
          openStores={[{ id: store.id, name: store.name, sessionId: store.sessionId! }]}
          locked
          retailPriceListId={retailPriceListId}
          paymentMethods={paymentMethods}
        />
      )}

      {mode === "vender" && (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        {/* Izquierda: búsqueda + grilla de productos */}
        <div className="space-y-4">
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" />
              <input className={`${input} h-12 pl-11 text-base shadow-sm`} placeholder="Buscar producto…" value={query} onChange={(e) => onSearch(e.target.value)} />
            </div>
            <div className="relative sm:w-56">
              <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" />
              <input className={`${input} h-12 pl-11 shadow-sm`} placeholder="Escanear código"
                onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) { onScan(v); (e.target as HTMLInputElement).value = ""; } } }} />
            </div>
          </div>
          {wholesale && !customer && <p className="text-xs font-medium text-warn">Identificá al cliente para ver los precios de su perfil.</p>}

          {results.length === 0 ? (
            <div className={`${card} flex flex-col items-center py-20 text-center`}>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-canvas text-faint"><Search className="h-5 w-5" /></span>
              <p className="mt-3 text-sm text-muted">{query.trim() ? "Sin resultados para esa búsqueda." : "No hay productos para mostrar."}</p>
            </div>
          ) : (
            <div className={`${card} max-h-[70vh] divide-y divide-line overflow-y-auto`}>
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onTile(p)}
                  disabled={p.stock <= 0}
                  className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas text-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent group-disabled:bg-canvas group-disabled:text-faint">
                    <Plus className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{p.name}</div>
                    {p.stock <= 0
                      ? <div className="mt-0.5 text-xs font-medium text-danger">Sin stock</div>
                      : p.variants.length > 1 && <div className="mt-0.5 text-xs text-muted">{p.variants.length} variantes · {p.stock} disp.</div>}
                  </div>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${p.price != null ? "text-ink" : "text-faint"}`}>{p.price != null ? formatMoney(p.price) : "sin precio"}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Derecha: el pedido (carrito + cobro) fijo */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <ClienteMayorista
            customer={customer}
            setCustomer={setCustomer}
            profiles={wholesale ? wholesaleProfiles : retailProfiles}
            title={wholesale ? "Cliente mayorista" : "Cliente"}
            walkIn={wholesale ? null : walkInCustomer}
          />

          <div className={card}>
            <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
              <ShoppingCart className="h-4 w-4 text-muted" />
              <span className="text-sm font-semibold text-ink">Pedido</span>
              {cart.length > 0 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{cart.length}</span>}
              {cart.length > 0 && <button onClick={() => setCart([])} className="ml-auto text-xs font-medium text-muted hover:text-danger">Vaciar</button>}
            </div>
            {cart.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-12 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-canvas text-faint"><ShoppingCart className="h-5 w-5" /></span>
                <p className="mt-3 text-sm text-muted">Tocá un producto para agregarlo.</p>
              </div>
            ) : (
              <div className="max-h-[38vh] divide-y divide-line overflow-y-auto">
                {cart.map((i) => (
                  <div key={i.variantId} className="flex items-center gap-3 px-4 py-3">
                    <Thumb src={i.image} size="h-11 w-11" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{i.name}</div>
                      <div className="text-xs text-muted">{i.label ? `${i.label} · ` : ""}{formatMoney(i.unitPrice)}</div>
                    </div>
                    <div className="flex items-center rounded-lg border border-line-strong">
                      <button onClick={() => setQty(i.variantId, i.quantity - 1)} className="p-1.5 text-muted transition-colors hover:text-ink"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="w-7 text-center text-sm font-medium tabular-nums">{i.quantity}</span>
                      <button onClick={() => setQty(i.variantId, i.quantity + 1)} className="p-1.5 text-muted transition-colors hover:text-ink"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="w-20 text-right text-sm font-semibold tabular-nums text-ink">{formatMoney(i.quantity * i.unitPrice)}</div>
                    <button onClick={() => setQty(i.variantId, 0)} className="text-faint transition-colors hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={`${card} p-5`}>
            <div className="flex justify-between text-sm">
              <span className="text-muted">Subtotal</span>
              <span className="tabular-nums text-ink">{formatMoney(subtotal)}</span>
            </div>

            {!wholesale && (coupon ? (
              <div className="mt-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-ok-bg px-2 py-1 font-medium text-ok">
                    <Ticket className="h-3.5 w-3.5" /> {coupon.code}
                    <button onClick={() => { setCoupon(null); setCouponCode(""); }} className="text-ok/60 hover:text-danger"><X className="h-3.5 w-3.5" /></button>
                  </span>
                  <span className="tabular-nums font-medium text-ok">−{formatMoney(discount)}</span>
                </div>
                {couponBelowMin && <p className="mt-1 text-xs text-warn">El carrito no alcanza el mínimo del cupón ({formatMoney(coupon.minAmount ?? 0)}).</p>}
              </div>
            ) : (
              <div className="mt-2.5 flex items-center gap-2">
                <div className="relative flex-1">
                  <Ticket className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") aplicarCupon(); }} placeholder="Cupón de descuento" className={`${input} py-2 pl-9 text-sm`} />
                </div>
                <button onClick={aplicarCupon} disabled={pending || !couponCode.trim()} className="shrink-0 rounded-xl border border-line-strong px-3.5 py-2 text-xs font-medium text-ink hover:bg-canvas disabled:opacity-50">Aplicar</button>
              </div>
            ))}

            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-sm font-medium text-muted">Total</span>
              <span className="text-3xl font-bold tabular-nums text-ink">{formatMoney(total)}</span>
            </div>
          </div>

          <div className={`${card} p-5`}>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-faint">Cobro</span>
              <div className="flex items-center gap-3">
                {wholesale && customer && <button onClick={aCuentaCorriente} className="text-xs font-medium text-accent hover:underline">A cuenta corriente</button>}
                <button onClick={() => setPayments((p) => { const n = [...p]; if (n[0]) n[0] = { ...n[0], amount: String(total) }; return n; })} className="text-xs font-medium text-accent hover:underline">Efectivo exacto</button>
              </div>
            </div>
            {wholesale && creditAvailable > 0 && (
              <button onClick={aplicarSaldoAFavor} className="mb-2.5 flex w-full items-center justify-between rounded-lg bg-ok-bg px-2.5 py-2 text-xs font-medium text-ok transition-opacity hover:opacity-80">
                <span>Saldo a favor: {formatMoney(creditAvailable)}</span>
                <span className="rounded-md bg-ok/15 px-2 py-0.5 font-semibold">Usar</span>
              </button>
            )}
            <div className="space-y-2">
              {payments.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select value={p.methodId} onChange={(e) => setPayments((arr) => arr.map((x, j) => j === idx ? { ...x, methodId: e.target.value } : x))} className={`${inputBase} min-w-0 flex-1`}>
                    {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="number" min={0} value={p.amount} onChange={(e) => setPayments((arr) => arr.map((x, j) => j === idx ? { ...x, amount: e.target.value } : x))} className={`${inputBase} w-24 shrink-0`} placeholder="0" />
                  {payments.length > 1 && <button onClick={() => setPayments((arr) => arr.filter((_, j) => j !== idx))} className="shrink-0 text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
            <button onClick={() => setPayments((p) => [...p, { methodId: methods[0]?.id ?? "", amount: "" }])} className="mt-2.5 flex items-center gap-1 text-xs font-medium text-muted hover:text-ink">
              <Plus className="h-3.5 w-3.5" /> Agregar medio
            </button>
            <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm">
              <span className="text-muted">{overpay > 0 ? "Queda a favor" : "Restante"}</span>
              <span className={`font-semibold tabular-nums ${remaining === 0 ? "text-ok" : overpay > 0 ? "text-ok" : "text-warn"}`}>
                {formatMoney(overpay > 0 ? overpay : remaining)}
              </span>
            </div>
          </div>

          <button onClick={confirmar} disabled={pending || cart.length === 0} className="w-full rounded-2xl bg-accent px-4 py-4 text-base font-semibold text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50">
            {pending ? "Registrando…" : `Confirmar venta · ${formatMoney(total)}`}
          </button>
        </div>
      </div>
      )}

      {variantPick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setVariantPick(null)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <Thumb src={variantPick.image} size="h-12 w-12" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{variantPick.name}</div>
                <div className="text-xs text-muted">{variantPick.price != null ? formatMoney(variantPick.price) : "sin precio"} · elegí la variante</div>
              </div>
              <button onClick={() => setVariantPick(null)} className="rounded-md p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {variantPick.variants.map((v) => (
                <button
                  key={v.id}
                  disabled={v.stock <= 0}
                  onClick={() => { addItem(v.id, variantPick.name, v.label, variantPick.price, variantPick.image, v.stock); setVariantPick(null); }}
                  className="flex flex-col rounded-xl border border-line-strong px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong disabled:hover:bg-transparent disabled:hover:text-ink"
                >
                  <span>{v.label ?? "Único"}</span>
                  <span className={`text-[11px] font-normal tabular-nums ${v.stock <= 0 ? "text-danger" : "text-muted"}`}>{v.stock <= 0 ? "sin stock" : `${v.stock} disp.`}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Identificación del cliente (mostrador y mayorista) ─────────
function ClienteMayorista({ customer, setCustomer, profiles, title = "Cliente mayorista", walkIn = null }: { customer: Customer | null; setCustomer: (c: Customer | null) => void; profiles: Profile[]; title?: string; walkIn?: Customer | null }) {
  const [doc, setDoc] = useState("");
  const [searched, setSearched] = useState(false);
  const [similar, setSimilar] = useState<Customer[]>([]);
  const [pending, start] = useTransition();
  const [nf, setNf] = useState({ name: "", profileTypeId: profiles[0]?.customerTypeId ?? "", docType: "DNI", email: "", phone: "" });

  function buscar() {
    const d = doc.trim();
    if (!d) return;
    start(async () => {
      const c = await buscarClientePorDoc(d);
      setSearched(true); setSimilar([]);
      if (c) { setCustomer(c); toast.success(`Cliente: ${c.name}`); return; }
      // Sin match exacto: ¿hay alguno parecido (DNI↔CUIT)? Preguntar antes de crear.
      const sim = await buscarClientesSimilares(d);
      if (sim.length) setSimilar(sim);
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
      <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium text-ink">{customer.name}</span>
          <button onClick={() => { setCustomer(null); setDoc(""); setSearched(false); setSimilar([]); }} className="ml-auto text-xs text-accent hover:underline">Cambiar</button>
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
    <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <IdCard className="h-4 w-4 text-muted" />
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="ml-auto text-xs text-warn">DNI/CUIT obligatorio</span>
      </div>
      <div className="flex items-center gap-2">
        <input value={doc} onChange={(e) => { setDoc(e.target.value); setSearched(false); setSimilar([]); }} onKeyDown={(e) => { if (e.key === "Enter") buscar(); }} placeholder="DNI o CUIT" className={input} />
        <button onClick={buscar} disabled={pending || !doc.trim()} className="shrink-0 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50">Buscar</button>
      </div>
      {walkIn && (
        <button onClick={() => { setCustomer(walkIn); toast.message("Venta sin identificar (Consumidor Final)."); }} className="mt-2 w-full rounded-lg border border-dashed border-line-strong px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent">
          Vender sin identificar → Consumidor Final
        </button>
      )}

      {similar.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="text-xs font-medium text-warn">Encontramos un cliente con un documento parecido. ¿Es este, o es otro?</div>
          {similar.map((s) => (
            <button key={s.id} onClick={() => { setCustomer(s); setSimilar([]); toast.success(`Cliente: ${s.name}`); }} className="flex w-full items-center gap-2 rounded-lg border border-line-strong px-3 py-2 text-left transition-colors hover:border-accent hover:bg-accent-soft">
              <UserCheck className="h-4 w-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1"><span className="text-sm font-medium text-ink">{s.name}</span><span className="ml-2 text-xs text-muted">{s.docType} {s.docNumber}</span></span>
              <span className="shrink-0 text-xs font-medium text-accent">Es este</span>
            </button>
          ))}
          <button onClick={() => { setSimilar([]); setSearched(true); setNf((p) => ({ ...p, name: "" })); }} className="text-xs font-medium text-muted hover:text-ink">No, es otro cliente → crear nuevo</button>
        </div>
      )}

      {searched && similar.length === 0 && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="flex items-center gap-1.5 text-xs text-muted"><UserPlus className="h-3.5 w-3.5" /> Cliente nuevo</div>
          <input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="Nombre / Razón social" className={input} />
          <div className="flex gap-2">
            <select value={nf.docType} onChange={(e) => setNf({ ...nf, docType: e.target.value })} className={`${input} ${profiles.length > 1 ? "w-24" : "flex-1"}`}>
              <option value="DNI">DNI</option>
              <option value="CUIT">CUIT</option>
              <option value="CUIL">CUIL</option>
            </select>
            {profiles.length > 1 && (
              <select value={nf.profileTypeId} onChange={(e) => setNf({ ...nf, profileTypeId: e.target.value })} className={`${input} flex-1`}>
                {profiles.map((p) => <option key={p.customerTypeId} value={p.customerTypeId}>{p.name}</option>)}
              </select>
            )}
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
