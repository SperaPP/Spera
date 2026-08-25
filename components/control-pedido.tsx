"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ScanLine, CheckCircle2, Circle, Truck, PackageCheck, AlertTriangle } from "lucide-react";
import { formatDateTime, formatMoney } from "@/lib/format";
import { marcarControlado, despacharPedido } from "@/app/(app)/logistica/actions";

type Item = { id: string; name: string; label: string | null; qty: number; sku: string | null; barcode: string | null };
type Method = { id: string; name: string };

const input =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15";
const card = "rounded-2xl border border-line bg-card p-5 shadow-sm";

export function ControlPedido({
  saleId, status, items, shippingMethods, total, paid, customerId, dispatch,
}: {
  saleId: string;
  status: string;
  items: Item[];
  shippingMethods: Method[];
  total: number;
  paid: number;
  customerId: string | null;
  dispatch: { method: string | null; tracking: string | null; notes: string | null; at: string | null };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [scanned, setScanned] = useState<Record<string, number>>({});
  const [methodId, setMethodId] = useState(shippingMethods[0]?.id ?? "");
  const [tracking, setTracking] = useState("");
  const [notes, setNotes] = useState("");

  const totalUnits = useMemo(() => items.reduce((a, i) => a + i.qty, 0), [items]);
  const scannedUnits = Object.values(scanned).reduce((a, n) => a + n, 0);
  const complete = items.every((i) => (scanned[i.id] ?? 0) >= i.qty);

  function onScan(code: string) {
    const c = code.trim().toLowerCase();
    if (!c) return;
    const item = items.find((i) => (i.barcode && i.barcode.toLowerCase() === c) || (i.sku && i.sku.toLowerCase() === c));
    if (!item) return toast.error(`Código ${code}: no pertenece a este pedido`);
    const cur = scanned[item.id] ?? 0;
    if (cur >= item.qty) return toast.error(`${item.name}: ya escaneaste las ${item.qty} unidad(es)`);
    setScanned((p) => ({ ...p, [item.id]: cur + 1 }));
  }

  function confirmarControl() {
    if (!complete) return toast.error("Faltan escanear prendas.");
    start(async () => {
      const r = await marcarControlado(saleId);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Pedido controlado.");
      router.refresh();
    });
  }
  function despachar() {
    if (!methodId) return toast.error("Elegí el método de despacho.");
    start(async () => {
      const r = await despacharPedido(saleId, methodId, tracking, notes);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Pedido despachado.");
      router.refresh();
    });
  }

  // ── Despachado: solo lectura ──────────────────────────────
  if (status === "despachado") {
    return (
      <div className={`${card} border-ok/30 bg-ok-bg`}>
        <div className="flex items-center gap-2 text-ok"><PackageCheck className="h-5 w-5" /><span className="font-semibold text-ink">Pedido despachado</span></div>
        <div className="mt-3 space-y-1 text-sm">
          <div><span className="text-muted">Método: </span><span className="font-medium text-ink">{dispatch.method ?? "—"}</span></div>
          {dispatch.tracking && <div><span className="text-muted">Seguimiento: </span><span className="font-medium text-ink">{dispatch.tracking}</span></div>}
          {dispatch.notes && <div><span className="text-muted">Notas: </span><span className="text-ink">{dispatch.notes}</span></div>}
          {dispatch.at && <div><span className="text-muted">Fecha: </span><span className="text-ink">{formatDateTime(dispatch.at)}</span></div>}
        </div>
      </div>
    );
  }

  const controlado = status === "controlado";
  const unpaid = Math.round((total - paid) * 100) / 100;
  const pago = unpaid <= 0.01;

  return (
    <div className="space-y-5">
      {/* Control */}
      <div className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Control por escaneo</h2>
          <span className="text-xs text-muted">{controlado ? "Ya controlado" : `${scannedUnits} / ${totalUnits} unidades`}</span>
        </div>

        {!controlado && (
          <div className="relative mb-3">
            <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" />
            <input autoFocus className={`${input} h-12 pl-11`} placeholder="Escaneá cada prenda del pedido…"
              onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value; (e.target as HTMLInputElement).value = ""; onScan(v); } }} />
          </div>
        )}

        <div className="divide-y divide-line rounded-lg border border-line">
          {items.map((i) => {
            const n = controlado ? i.qty : (scanned[i.id] ?? 0);
            const ok = n >= i.qty;
            return (
              <div key={i.id} className={`flex items-center gap-3 px-3 py-2.5 ${ok ? "opacity-60" : ""}`}>
                {ok ? <CheckCircle2 className="h-5 w-5 shrink-0 text-ok" /> : <Circle className="h-5 w-5 shrink-0 text-faint" />}
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm font-medium text-ink ${ok ? "line-through" : ""}`}>{i.name}{i.label ? <span className="ml-2 text-xs text-muted no-underline">{i.label}</span> : null}</div>
                  {i.sku && <div className="font-mono text-xs text-muted">{i.sku}</div>}
                </div>
                <span className={`shrink-0 text-sm font-semibold tabular-nums ${ok ? "text-ok" : "text-ink"}`}>{n} / {i.qty}</span>
              </div>
            );
          })}
        </div>

        {complete && !controlado && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-ok/30 bg-ok-bg px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-ok" />
            <span className="font-medium text-ink">Pedido correctamente controlado</span>
            <button onClick={confirmarControl} disabled={pending} className="ml-auto rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
              {pending ? "Guardando…" : "Confirmar control"}
            </button>
          </div>
        )}
      </div>

      {/* Despacho (habilitado tras controlar y con el pedido pago) */}
      <div className={`${card} ${!controlado ? "opacity-60" : ""}`}>
        <div className="mb-3 flex items-center gap-2">
          <Truck className="h-4 w-4 text-muted" />
          <h2 className="text-sm font-medium text-ink">Despacho</h2>
          {!controlado && <span className="text-xs text-muted">— controlá el pedido primero</span>}
        </div>

        {!pago && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-danger" />
            <span className="text-sm text-ink">Pedido sin pagar — falta <strong>{formatMoney(unpaid)}</strong>. No se puede despachar hasta cobrarlo.</span>
            {customerId && (
              <Link href="/cobranzas/nueva" className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover">Ir a cobrar</Link>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Método</label>
            <select disabled={!controlado || !pago} value={methodId} onChange={(e) => setMethodId(e.target.value)} className={input}>
              {shippingMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">N° de seguimiento (opcional)</label>
            <input disabled={!controlado || !pago} value={tracking} onChange={(e) => setTracking(e.target.value)} className={input} placeholder="—" />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-muted">Notas (opcional)</label>
            <input disabled={!controlado || !pago} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} placeholder="Referencia del despacho" />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={despachar} disabled={pending || !controlado || !pago} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50">
            <Truck className="h-4 w-4" /> {pending ? "Despachando…" : "Despachar"}
          </button>
        </div>
        {controlado && <p className="mt-2 text-xs text-muted">El pedido está controlado. Podés despacharlo ahora o dejarlo en espera y volver más tarde.</p>}
      </div>
    </div>
  );
}
