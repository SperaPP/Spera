"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Search, ScanLine, Trash2, Plus, Minus, Receipt, Gift, RotateCcw, IdCard, UserCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { buscarProductos, buscarPorCodigo, buscarClientePorDoc } from "@/app/(app)/pos/actions";
import { buscarTicket, previewCambio, crearCambio, type PreviewItem } from "@/app/(app)/cambios/actions";

type OpenStore = { id: string; name: string; sessionId: string };
type Method = { id: string; name: string; kind: string };
type Customer = NonNullable<Awaited<ReturnType<typeof buscarClientePorDoc>>>;
type CartItem = { variantId: string; name: string; label: string | null; quantity: number; unitPrice: number };
type Payment = { methodId: string; amount: string };
type Ret = { name: string; label: string | null; qty: number };

const input =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15";
const card = "rounded-2xl border border-line bg-card p-5 shadow-sm";

export function NuevoCambioForm({ openStores, locked, retailPriceListId, paymentMethods }: { openStores: OpenStore[]; locked: boolean; retailPriceListId: string | null; paymentMethods: Method[] }) {
  const [storeId, setStoreId] = useState(openStores[0]?.id ?? "");
  const store = openStores.find((s) => s.id === storeId) ?? openStores[0];

  const [scope, setScope] = useState<"minorista" | "mayorista" | null>(null);
  const [ticketInput, setTicketInput] = useState("");
  const [scopeSale, setScopeSale] = useState<{ id: string; number: number } | null>(null);
  const [doc, setDoc] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);

  const [returned, setReturned] = useState<Record<string, Ret>>({});
  const [preview, setPreview] = useState<{ totalCredit: number; items: PreviewItem[]; allMatched: boolean }>({ totalCredit: 0, items: [], allMatched: true });

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof buscarProductos>>>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [done, setDone] = useState<{ id: string | null } | null>(null);
  const [pending, start] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scopeReady = (scope === "minorista" && scopeSale) || (scope === "mayorista" && customer);
  const priceListId = scope === "mayorista" ? (customer?.priceListId ?? null) : retailPriceListId;

  const credit = preview.totalCredit;
  const newTotal = cart.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const applied = Math.min(credit, newTotal);
  const leftover = credit - applied;
  const diff = Math.max(0, newTotal - credit);
  const diffPaid = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const diffRemaining = Math.round((diff - diffPaid) * 100) / 100;

  const diffMethods = paymentMethods.filter((m) => {
    if (m.kind === "saldo_favor" || m.kind === "cambio") return false;
    if (m.kind === "cuenta_corriente") return scope === "mayorista";
    return true;
  });

  // Preview del crédito (FIFO) cada vez que cambia lo devuelto o el alcance.
  useEffect(() => {
    const list = Object.entries(returned).map(([variantId, r]) => ({ variantId, quantity: r.qty }));
    if (!scopeReady || list.length === 0) { setPreview({ totalCredit: 0, items: [], allMatched: true }); return; }
    previewCambio(scope === "mayorista" ? customer!.id : null, scope === "minorista" ? scopeSale!.id : null, list).then(setPreview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned, scopeReady]);

  function buscarVenta() {
    const n = ticketInput.trim();
    if (!n) return;
    start(async () => {
      const r = await buscarTicket(n);
      if (!r.ok) { toast.error(r.error); return; }
      setScopeSale({ id: r.saleId, number: r.number });
      toast.success(`Ticket #${r.number}`);
    });
  }
  function buscarCliente() {
    const d = doc.trim();
    if (!d) return;
    start(async () => {
      const c = await buscarClientePorDoc(d);
      if (!c) { toast.error("No se encontró un cliente con ese documento."); return; }
      setCustomer(c);
      toast.success(`Cliente: ${c.name}`);
    });
  }

  async function scanReturn(code: string) {
    const r = await buscarPorCodigo(code, null);
    if (r.notFound) return toast.error(`Código ${code}: sin resultados`);
    setReturned((prev) => ({ ...prev, [r.variantId]: { name: r.name, label: r.label, qty: (prev[r.variantId]?.qty ?? 0) + 1 } }));
  }
  function setRetQty(variantId: string, qty: number) {
    setReturned((prev) => {
      if (qty <= 0) { const n = { ...prev }; delete n[variantId]; return n; }
      return { ...prev, [variantId]: { ...prev[variantId], qty } };
    });
  }

  function onSearch(v: string) {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => { setResults(v.trim().length >= 2 ? await buscarProductos(v, priceListId) : []); }, 250);
  }
  function addItem(variantId: string, name: string, label: string | null, price: number | null) {
    setCart((prev) => {
      const i = prev.findIndex((x) => x.variantId === variantId);
      if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], quantity: next[i].quantity + 1 }; return next; }
      return [...prev, { variantId, name, label, quantity: 1, unitPrice: price ?? 0 }];
    });
  }
  function setQty(variantId: string, qty: number) {
    setCart((prev) => prev.flatMap((x) => (x.variantId === variantId ? (qty <= 0 ? [] : [{ ...x, quantity: qty }]) : [x])));
  }
  async function onScanNew(code: string) {
    const r = await buscarPorCodigo(code, priceListId);
    if (r.notFound) return toast.error(`Código ${code}: sin resultados`);
    addItem(r.variantId, r.name, r.label, r.price);
  }

  function resetAll() {
    setScope(null); setTicketInput(""); setScopeSale(null); setDoc(""); setCustomer(null);
    setReturned({}); setPreview({ totalCredit: 0, items: [], allMatched: true });
    setQuery(""); setResults([]); setCart([]); setPayments([]);
  }

  function confirmar() {
    if (!scopeReady) return toast.error("Definí el alcance (cliente o ticket).");
    if (Object.keys(returned).length === 0) return toast.error("Escaneá qué se devuelve.");
    if (!preview.allMatched) return toast.error("Hay prendas escaneadas sin compra elegible (30 días / ya cambiadas).");
    if (newTotal === 0 && scope === "minorista") return toast.error("Elegí la prenda nueva del cambio.");
    if (diff > 0 && diffRemaining !== 0) return toast.error(diffRemaining > 0 ? `Falta cubrir la diferencia (${formatMoney(diffRemaining)})` : "El pago supera la diferencia");
    if (scope === "minorista" && leftover > 0 && !confirm(`La prenda nueva es más barata: se pierden ${formatMoney(leftover)} (sin vale ni vuelto). ¿Confirmar?`)) return;

    start(async () => {
      const res = await crearCambio({
        storeId: store.id,
        cashSessionId: store.sessionId,
        customerId: scope === "mayorista" ? customer!.id : null,
        scopeSaleId: scope === "minorista" ? scopeSale!.id : null,
        returned: Object.entries(returned).map(([variantId, r]) => ({ variantId, quantity: r.qty })),
        priceListId,
        newItems: cart.map((i) => ({ variantId: i.variantId, productName: i.name, variantLabel: i.label, quantity: i.quantity, unitPrice: i.unitPrice })),
        diffPayments: diff > 0 ? payments.filter((p) => p.methodId && Number(p.amount) > 0).map((p) => ({ paymentMethodId: p.methodId, amount: Number(p.amount) })) : [],
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success("Cambio registrado.");
      const newId = res.id ?? null;
      resetAll();
      setDone({ id: newId });
    });
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-ok/30 bg-ok-bg p-6 text-center shadow-sm">
        <p className="font-medium text-ink">Cambio registrado ✓</p>
        {done.id ? (
          <>
            <p className="mt-1 text-sm text-muted">Imprimí el ticket de la prenda nueva (sirve para un futuro cambio).</p>
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={() => window.open(`/ventas/${done.id}/ticket`, "_blank")} className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"><Receipt className="h-4 w-4" /> Ticket</button>
              <button onClick={() => window.open(`/ventas/${done.id}/ticket?regalo=1`, "_blank")} className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"><Gift className="h-4 w-4" /> Regalo</button>
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">El crédito quedó como saldo a favor en la cuenta del cliente.</p>
        )}
        <button onClick={() => setDone(null)} className="mt-4 text-sm text-accent hover:underline">Registrar otro cambio</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {locked || openStores.length <= 1 ? (
        <div className="text-sm text-muted">Sucursal: <span className="font-medium text-ink">{store?.name}</span></div>
      ) : (
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={`${input} w-auto`}>
          {openStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}

      {/* 1. Alcance */}
      <div className={card}>
        <h2 className="mb-3 text-sm font-medium text-ink">1. Alcance del cambio</h2>
        {!scope ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button onClick={() => setScope("minorista")} className="rounded-xl border border-line-strong px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent-soft/40">
              <div className="text-sm font-medium text-ink">Mostrador (por ticket)</div>
              <div className="text-xs text-muted">Consumidor final: escaneás el ticket de la compra.</div>
            </button>
            <button onClick={() => setScope("mayorista")} className="rounded-xl border border-line-strong px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent-soft/40">
              <div className="text-sm font-medium text-ink">Mayorista (por cliente)</div>
              <div className="text-xs text-muted">Busca en todos los pedidos del cliente (DNI/CUIT).</div>
            </button>
          </div>
        ) : scope === "minorista" ? (
          scopeSale ? (
            <div className="flex items-center gap-2 text-sm">
              <UserCheck className="h-4 w-4 text-accent" />
              <span className="text-ink">Ticket #{scopeSale.number}</span>
              <button onClick={() => { setScopeSale(null); setReturned({}); }} className="ml-auto text-xs text-accent hover:underline">Cambiar</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input className={`${input} pl-9`} placeholder="N° de ticket (o escaneá)" value={ticketInput} onChange={(e) => setTicketInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") buscarVenta(); }} />
              </div>
              <button onClick={buscarVenta} disabled={pending || !ticketInput.trim()} className="shrink-0 rounded-xl border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50">Buscar</button>
              <button onClick={() => setScope(null)} className="shrink-0 text-xs text-muted hover:text-ink">Volver</button>
            </div>
          )
        ) : (
          customer ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <UserCheck className="h-4 w-4 text-accent" />
              <span className="font-medium text-ink">{customer.name}</span>
              {customer.profileName && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{customer.profileName}</span>}
              <span className={`text-xs ${customer.balance > 0 ? "text-danger" : customer.balance < 0 ? "text-ok" : "text-muted"}`}>
                {customer.balance > 0 ? `Debe ${formatMoney(customer.balance)}` : customer.balance < 0 ? `A favor ${formatMoney(-customer.balance)}` : "Sin saldo"}
              </span>
              <button onClick={() => { setCustomer(null); setReturned({}); }} className="ml-auto text-xs text-accent hover:underline">Cambiar</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <IdCard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input className={`${input} pl-9`} placeholder="DNI o CUIT del cliente" value={doc} onChange={(e) => setDoc(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") buscarCliente(); }} />
              </div>
              <button onClick={buscarCliente} disabled={pending || !doc.trim()} className="shrink-0 rounded-xl border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50">Buscar</button>
              <button onClick={() => setScope(null)} className="shrink-0 text-xs text-muted hover:text-ink">Volver</button>
            </div>
          )
        )}
      </div>

      {scopeReady && (
        <>
          {/* 2. Devoluciones (escaneo) */}
          <div className={card}>
            <h2 className="mb-1 text-sm font-medium text-ink">2. Prendas a devolver</h2>
            <p className="mb-3 text-xs text-muted">Escaneá cada prenda. Se matchea con {scope === "mayorista" ? "los pedidos del cliente" : "el ticket"} (más antiguo primero) y se acredita al precio pagado.</p>
            <div className="relative">
              <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <input className={`${input} pl-9`} placeholder="Escanear prenda a devolver…"
                onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) { scanReturn(v); (e.target as HTMLInputElement).value = ""; } } }} />
            </div>
            {Object.keys(returned).length > 0 && (
              <div className="mt-3 divide-y divide-line rounded-lg border border-line">
                {Object.entries(returned).map(([variantId, r]) => {
                  const pi = preview.items.find((x) => x.variantId === variantId);
                  const ok = !pi || pi.matched >= pi.requested;
                  return (
                    <div key={variantId} className="flex items-center gap-3 px-3 py-2.5">
                      {ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{r.name}{r.label ? <span className="ml-2 text-xs text-muted">{r.label}</span> : null}</div>
                        {!ok && <div className="text-xs text-warn">Solo {pi?.matched ?? 0} de {r.qty} tienen compra elegible.</div>}
                        {ok && pi && <div className="text-xs text-muted">Crédito {formatMoney(pi.credit)}</div>}
                      </div>
                      <div className="flex items-center rounded-lg border border-line-strong">
                        <button onClick={() => setRetQty(variantId, r.qty - 1)} className="p-1.5 text-muted hover:text-ink"><Minus className="h-3.5 w-3.5" /></button>
                        <span className="w-7 text-center text-sm tabular-nums">{r.qty}</span>
                        <button onClick={() => setRetQty(variantId, r.qty + 1)} className="p-1.5 text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                      <button onClick={() => setRetQty(variantId, 0)} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-3 flex justify-between text-sm"><span className="text-muted">Crédito por lo devuelto</span><span className="font-semibold tabular-nums text-ink">{formatMoney(credit)}</span></div>
          </div>

          {/* 3. Prenda nueva */}
          <div className={card}>
            <h2 className="mb-3 text-sm font-medium text-ink">3. Prenda nueva {scope === "mayorista" && <span className="text-xs font-normal text-muted">(opcional; el crédito queda a favor)</span>}</h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input className={`${input} pl-9`} placeholder="Buscar producto…" value={query} onChange={(e) => onSearch(e.target.value)} />
              </div>
              <div className="relative sm:w-52">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input className={`${input} pl-9`} placeholder="Escanear código"
                  onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) { onScanNew(v); (e.target as HTMLInputElement).value = ""; } } }} />
              </div>
            </div>
            {results.length > 0 && (
              <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                {results.map((r) => (
                  <div key={r.id} className="rounded-lg border border-line p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">{r.name}</span>
                      <span className="text-sm text-muted">{r.price != null ? formatMoney(r.price) : "sin precio"}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.variants.map((v) => (
                        <button key={v.id} onClick={() => addItem(v.id, r.name, v.label, r.price)} className="rounded-md border border-line-strong px-2 py-1 text-xs text-ink transition-colors hover:border-accent hover:text-accent">{v.label ?? "Agregar"}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {cart.length > 0 && (
              <div className="mt-3 divide-y divide-line rounded-lg border border-line">
                {cart.map((i) => (
                  <div key={i.variantId} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{i.name}</div>
                      {i.label && <div className="text-xs text-muted">{i.label}</div>}
                    </div>
                    <div className="flex items-center rounded-lg border border-line-strong">
                      <button onClick={() => setQty(i.variantId, i.quantity - 1)} className="p-1.5 text-muted hover:text-ink"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="w-7 text-center text-sm tabular-nums">{i.quantity}</span>
                      <button onClick={() => setQty(i.variantId, i.quantity + 1)} className="p-1.5 text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="w-24 text-right text-sm font-semibold tabular-nums text-ink">{formatMoney(i.quantity * i.unitPrice)}</div>
                    <button onClick={() => setQty(i.variantId, 0)} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 4. Liquidación */}
          <div className={card}>
            <h2 className="mb-3 text-sm font-medium text-ink">4. Liquidación</h2>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted">Crédito (devuelto)</span><span className="tabular-nums text-ink">{formatMoney(credit)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Prenda nueva</span><span className="tabular-nums text-ink">{formatMoney(newTotal)}</span></div>
            </div>
            {diff > 0 ? (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-2 flex justify-between text-sm"><span className="font-medium text-ink">A cobrar (diferencia)</span><span className="font-semibold tabular-nums text-ink">{formatMoney(diff)}</span></div>
                <div className="space-y-2">
                  {(payments.length ? payments : [{ methodId: "", amount: "" }]).map((p, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select value={p.methodId} onChange={(e) => setPayments((arr) => { const base = arr.length ? [...arr] : [{ methodId: "", amount: "" }]; base[idx] = { ...base[idx], methodId: e.target.value }; return base; })} className={`${input} min-w-0 flex-1`}>
                        <option value="">Medio…</option>
                        {diffMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <input type="number" min={0} value={p.amount} onChange={(e) => setPayments((arr) => { const base = arr.length ? [...arr] : [{ methodId: "", amount: "" }]; base[idx] = { ...base[idx], amount: e.target.value }; return base; })} className={`${input} w-28`} placeholder="0" />
                      {payments.length > 1 && <button onClick={() => setPayments((arr) => arr.filter((_, j) => j !== idx))} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
                    </div>
                  ))}
                </div>
                <button onClick={() => setPayments((p) => [...(p.length ? p : [{ methodId: "", amount: "" }]), { methodId: diffMethods[0]?.id ?? "", amount: "" }])} className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /> Agregar medio</button>
                <div className="mt-2 flex justify-between text-sm"><span className="text-muted">Restante</span><span className={`font-medium tabular-nums ${diffRemaining === 0 ? "text-ok" : "text-warn"}`}>{formatMoney(diffRemaining)}</span></div>
              </div>
            ) : leftover > 0 ? (
              <p className={`mt-3 border-t border-line pt-3 text-sm ${scope === "mayorista" ? "text-ok" : "text-warn"}`}>
                {scope === "mayorista"
                  ? `Quedan ${formatMoney(leftover)} a favor en la cuenta del cliente.`
                  : `La prenda nueva es más barata: se pierden ${formatMoney(leftover)} (sin vale ni vuelto).`}
              </p>
            ) : newTotal > 0 ? (
              <p className="mt-3 border-t border-line pt-3 text-sm text-ok">Cambio parejo, no se cobra diferencia.</p>
            ) : (
              <p className="mt-3 border-t border-line pt-3 text-sm text-ok">Devolución: el crédito queda a favor del cliente.</p>
            )}
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={resetAll} className="flex items-center gap-1.5 rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas"><RotateCcw className="h-4 w-4" /> Limpiar</button>
        <button type="button" onClick={confirmar} disabled={pending || !scopeReady} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">{pending ? "Registrando…" : "Confirmar cambio"}</button>
      </div>
    </div>
  );
}
