"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Search, ScanLine, Trash2, Plus, Minus, Receipt, Gift, RotateCcw } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { buscarProductos, buscarPorCodigo } from "@/app/(app)/pos/actions";
import { buscarVentaParaCambio, crearCambio, type CambioSale } from "@/app/(app)/cambios/actions";

type OpenStore = { id: string; name: string; sessionId: string };
type Method = { id: string; name: string; kind: string };
type CartItem = { variantId: string; name: string; label: string | null; quantity: number; unitPrice: number };
type Payment = { methodId: string; amount: string };

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function NuevoCambioForm({ openStores, locked, retailPriceListId, diffMethods }: { openStores: OpenStore[]; locked: boolean; retailPriceListId: string | null; diffMethods: Method[] }) {
  const [storeId, setStoreId] = useState(openStores[0]?.id ?? "");
  const store = openStores.find((s) => s.id === storeId) ?? openStores[0];

  const [numberInput, setNumberInput] = useState("");
  const [sale, setSale] = useState<CambioSale | null>(null);
  const [ret, setRet] = useState<Record<string, number>>({}); // saleItemId → qty a devolver

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof buscarProductos>>>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([{ methodId: diffMethods[0]?.id ?? "", amount: "" }]);
  const [done, setDone] = useState<{ id: string } | null>(null);
  const [pending, start] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const credit = sale ? sale.items.reduce((a, it) => a + (ret[it.id] ?? 0) * it.unitPrice, 0) : 0;
  const newTotal = cart.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const diff = newTotal - credit;
  const forfeit = diff < 0 ? -diff : 0;
  const diffPaid = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const diffRemaining = Math.round((diff - diffPaid) * 100) / 100;

  function buscarVenta() {
    const n = numberInput.trim();
    if (!n) return;
    start(async () => {
      const r = await buscarVentaParaCambio(n);
      if (!r.ok) { toast.error(r.error); return; }
      if (!r.sale.within30) { toast.error("La venta supera los 30 días de cambio."); return; }
      if (r.sale.items.every((it) => it.remaining <= 0)) { toast.error("Esta venta ya no tiene prendas para cambiar."); return; }
      setSale(r.sale);
      setRet({});
    });
  }

  function onSearch(v: string) {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setResults(v.trim().length >= 2 ? await buscarProductos(v, retailPriceListId) : []);
    }, 250);
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
  async function onScan(code: string) {
    const r = await buscarPorCodigo(code, retailPriceListId);
    if (r.notFound) return toast.error(`Código ${code}: sin resultados`);
    addItem(r.variantId, r.name, r.label, r.price);
  }

  function reset() {
    setNumberInput(""); setSale(null); setRet({}); setQuery(""); setResults([]);
    setCart([]); setPayments([{ methodId: diffMethods[0]?.id ?? "", amount: "" }]);
  }

  function confirmar() {
    if (!sale) return toast.error("Buscá la venta a cambiar.");
    if (credit <= 0) return toast.error("Elegí qué prenda se devuelve.");
    if (cart.length === 0) return toast.error("Elegí la prenda nueva del cambio.");
    if (diff > 0 && diffRemaining !== 0) return toast.error(diffRemaining > 0 ? `Falta cobrar la diferencia (${formatMoney(diffRemaining)})` : `La diferencia cobrada es de más`);
    if (forfeit > 0 && !confirm(`La prenda nueva es más barata. Se pierden ${formatMoney(forfeit)} a favor (no hay vuelto ni vale). ¿Confirmar el cambio?`)) return;

    const returned = sale.items.filter((it) => (ret[it.id] ?? 0) > 0).map((it) => ({ saleItemId: it.id, quantity: ret[it.id] }));

    start(async () => {
      const res = await crearCambio({
        storeId: store.id,
        cashSessionId: store.sessionId,
        originalSaleId: sale.id,
        returned,
        newItems: cart.map((i) => ({ variantId: i.variantId, productName: i.name, variantLabel: i.label, quantity: i.quantity, unitPrice: i.unitPrice })),
        diffPayments: diff > 0 ? payments.filter((p) => p.methodId && Number(p.amount) > 0).map((p) => ({ paymentMethodId: p.methodId, amount: Number(p.amount) })) : [],
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success("Cambio registrado.");
      if (res.id) setDone({ id: res.id });
      reset();
    });
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-ok/30 bg-ok-bg p-6 text-center">
        <p className="font-medium text-ink">Cambio registrado ✓</p>
        <p className="mt-1 text-sm text-muted">Imprimí el ticket de la prenda nueva (sirve para un futuro cambio).</p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={() => window.open(`/ventas/${done.id}/ticket`, "_blank")} className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"><Receipt className="h-4 w-4" /> Ticket</button>
          <button onClick={() => window.open(`/ventas/${done.id}/ticket?regalo=1`, "_blank")} className="flex items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"><Gift className="h-4 w-4" /> Regalo</button>
        </div>
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

      {/* 1. Venta a cambiar */}
      <div className="rounded-xl border border-line bg-card p-5">
        <h2 className="mb-3 text-sm font-medium text-ink">1. Venta a cambiar</h2>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input className={`${input} pl-9`} placeholder="N° de venta (o escaneá el ticket)" value={numberInput}
              onChange={(e) => setNumberInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") buscarVenta(); }} />
          </div>
          <button onClick={buscarVenta} disabled={pending || !numberInput.trim()} className="shrink-0 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50">Buscar</button>
        </div>

        {sale && (
          <div className="mt-4">
            <p className="mb-2 text-xs text-muted">Venta #{sale.number}{sale.storeName ? ` · ${sale.storeName}` : ""}. Elegí cuántas unidades de cada prenda se devuelven.</p>
            <div className="divide-y divide-line rounded-lg border border-line">
              {sale.items.map((it) => (
                <div key={it.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{it.productName}{it.variantLabel ? <span className="ml-2 text-xs text-muted">{it.variantLabel}</span> : null}</div>
                    <div className="text-xs text-muted">{formatMoney(it.unitPrice)} c/u · {it.remaining > 0 ? `${it.remaining} disponible(s)` : "ya cambiada"}{it.returnedQty > 0 ? ` · ${it.returnedQty} devuelta(s)` : ""}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setRet((p) => ({ ...p, [it.id]: Math.max(0, (p[it.id] ?? 0) - 1) }))} disabled={(ret[it.id] ?? 0) <= 0} className="rounded-md border border-line-strong p-1 text-muted hover:text-ink disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="w-7 text-center text-sm tabular-nums">{ret[it.id] ?? 0}</span>
                    <button onClick={() => setRet((p) => ({ ...p, [it.id]: Math.min(it.remaining, (p[it.id] ?? 0) + 1) }))} disabled={(ret[it.id] ?? 0) >= it.remaining} className="rounded-md border border-line-strong p-1 text-muted hover:text-ink disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-sm"><span className="text-muted">Crédito por lo devuelto</span><span className="font-medium tabular-nums text-ink">{formatMoney(credit)}</span></div>
          </div>
        )}
      </div>

      {/* 2. Prenda nueva */}
      <div className="rounded-xl border border-line bg-card p-5">
        <h2 className="mb-3 text-sm font-medium text-ink">2. Prenda nueva</h2>
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
                <div className="flex items-center gap-1">
                  <button onClick={() => setQty(i.variantId, i.quantity - 1)} className="rounded-md border border-line-strong p-1 text-muted hover:text-ink"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="w-7 text-center text-sm tabular-nums">{i.quantity}</span>
                  <button onClick={() => setQty(i.variantId, i.quantity + 1)} className="rounded-md border border-line-strong p-1 text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /></button>
                </div>
                <div className="w-24 text-right text-sm font-medium tabular-nums text-ink">{formatMoney(i.quantity * i.unitPrice)}</div>
                <button onClick={() => setQty(i.variantId, 0)} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Cuenta */}
      <div className="rounded-xl border border-line bg-card p-5">
        <h2 className="mb-3 text-sm font-medium text-ink">3. Diferencia</h2>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted">Crédito (devuelto)</span><span className="tabular-nums text-ink">{formatMoney(credit)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Prenda nueva</span><span className="tabular-nums text-ink">{formatMoney(newTotal)}</span></div>
        </div>

        {diff > 0 ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-2 flex justify-between text-sm"><span className="font-medium text-ink">A cobrar (diferencia)</span><span className="font-semibold tabular-nums text-ink">{formatMoney(diff)}</span></div>
            <div className="space-y-2">
              {payments.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select value={p.methodId} onChange={(e) => setPayments((arr) => arr.map((x, j) => j === idx ? { ...x, methodId: e.target.value } : x))} className={`${input} flex-1`}>
                    {diffMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="number" min={0} value={p.amount} onChange={(e) => setPayments((arr) => arr.map((x, j) => j === idx ? { ...x, amount: e.target.value } : x))} className={`${input} w-28`} placeholder="0" />
                  {payments.length > 1 && <button onClick={() => setPayments((arr) => arr.filter((_, j) => j !== idx))} className="text-faint hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
            <button onClick={() => setPayments((p) => [...p, { methodId: diffMethods[0]?.id ?? "", amount: "" }])} className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-ink"><Plus className="h-3.5 w-3.5" /> Agregar medio</button>
            <div className="mt-2 flex justify-between text-sm"><span className="text-muted">Restante</span><span className={`font-medium tabular-nums ${diffRemaining === 0 ? "text-ok" : "text-warn"}`}>{formatMoney(diffRemaining)}</span></div>
          </div>
        ) : forfeit > 0 ? (
          <p className="mt-3 border-t border-line pt-3 text-sm text-warn">La prenda nueva es más barata: se pierden {formatMoney(forfeit)} a favor (no hay vuelto ni vale). Sumá algo más para aprovecharlos.</p>
        ) : (
          <p className="mt-3 border-t border-line pt-3 text-sm text-ok">Cambio parejo, no se cobra diferencia.</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={reset} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas"><RotateCcw className="h-4 w-4" /> Limpiar</button>
        <button type="button" onClick={confirmar} disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">{pending ? "Registrando…" : "Confirmar cambio"}</button>
      </div>
    </div>
  );
}
