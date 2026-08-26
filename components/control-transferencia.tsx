"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ScanLine, CheckCircle2, Circle, PackageCheck, XCircle } from "lucide-react";
import { enviarTransferencia, recibirTransferencia, cancelarTransferencia } from "@/app/(app)/transferencias/actions";

type Item = { id: string; name: string; label: string | null; qty: number; sku: string | null; barcode: string | null };

const input =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-4 focus:ring-accent/15";
const card = "rounded-2xl border border-line bg-card p-5 shadow-sm";

export function ControlTransferencia({ transferId, status, items }: { transferId: string; status: string; items: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [scanned, setScanned] = useState<Record<string, number>>({});

  const totalUnits = useMemo(() => items.reduce((a, i) => a + i.qty, 0), [items]);
  const scannedUnits = Object.values(scanned).reduce((a, n) => a + n, 0);
  const complete = items.every((i) => (scanned[i.id] ?? 0) >= i.qty);

  function onScan(code: string) {
    const c = code.trim().toLowerCase();
    if (!c) return;
    const item = items.find((i) => (i.barcode && i.barcode.toLowerCase() === c) || (i.sku && i.sku.toLowerCase() === c));
    if (!item) return toast.error(`Código ${code}: no pertenece a esta transferencia`);
    const cur = scanned[item.id] ?? 0;
    if (cur >= item.qty) return toast.error(`${item.name}: ya escaneaste las ${item.qty} unidad(es)`);
    setScanned((p) => ({ ...p, [item.id]: cur + 1 }));
  }

  const isSend = status === "creada"; // creada → controlar y enviar; enviada → recibir.

  function confirmar() {
    if (!complete) return toast.error(isSend ? "Faltan escanear prendas para enviar." : "Faltan escanear prendas para aceptar la recepción.");
    start(async () => {
      const r = isSend ? await enviarTransferencia(transferId) : await recibirTransferencia(transferId);
      if (r.error) { toast.error(r.error); return; }
      toast.success(isSend ? "Transferencia enviada. Salió del depósito de origen." : "Transferencia recibida. Stock actualizado.");
      router.refresh();
    });
  }
  function cancelar() {
    const msg = isSend ? "Cancelar la transferencia (todavía no salió stock). ¿Seguir?" : "Cancelar la transferencia repone el stock en el origen. ¿Seguir?";
    if (!confirm(msg)) return;
    start(async () => {
      const r = await cancelarTransferencia(transferId);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Transferencia cancelada.");
      router.refresh();
    });
  }

  if (status === "recibida") {
    return (
      <div className={`${card} border-ok/30 bg-ok-bg`}>
        <div className="flex items-center gap-2 text-ok"><PackageCheck className="h-5 w-5" /><span className="font-semibold text-ink">Transferencia recibida</span></div>
        <p className="mt-1 text-sm text-muted">El stock ya se incrementó en el depósito de destino.</p>
      </div>
    );
  }
  if (status === "cancelada") {
    return (
      <div className={`${card} border-danger/30`}>
        <div className="flex items-center gap-2 text-danger"><XCircle className="h-5 w-5" /><span className="font-semibold text-ink">Transferencia cancelada</span></div>
        <p className="mt-1 text-sm text-muted">El stock se repuso en el depósito de origen.</p>
      </div>
    );
  }

  return (
    <div className={card}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">{isSend ? "Control de armado por escaneo" : "Recepción por escaneo"}</h2>
        <span className="text-xs text-muted">{scannedUnits} / {totalUnits} unidades</span>
      </div>

      <div className="relative mb-3">
        <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" />
        <input autoFocus className={`${input} h-12 pl-11`} placeholder={isSend ? "Escaneá cada prenda a enviar…" : "Escaneá cada prenda recibida…"}
          onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value; (e.target as HTMLInputElement).value = ""; onScan(v); } }} />
      </div>

      <div className="divide-y divide-line rounded-lg border border-line">
        {items.map((i) => {
          const n = scanned[i.id] ?? 0;
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

      {complete && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-ok/30 bg-ok-bg px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-ok" />
          <span className="font-medium text-ink">Todo controlado</span>
          <button onClick={confirmar} disabled={pending} className="ml-auto rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
            {pending ? (isSend ? "Enviando…" : "Recibiendo…") : (isSend ? "Confirmar envío" : "Aceptar y recibir")}
          </button>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
        <p className="text-xs text-muted">{isSend ? "El stock del origen sale recién al confirmar el envío." : "No se acepta recepción parcial. Si algo no llegó, cancelá o resolvelo manualmente."}</p>
        <button onClick={cancelar} disabled={pending} className="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-bg disabled:opacity-50">
          Cancelar transferencia
        </button>
      </div>
    </div>
  );
}
