"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Wallet, Lock, Unlock } from "lucide-react";
import { formatMoney, formatDateTime } from "@/lib/format";
import { abrirCaja, cerrarCaja } from "@/app/(app)/caja/actions";
import type { CajaRow } from "@/app/(app)/caja/page";

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

function Abrir({ storeId }: { storeId: string }) {
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex items-end gap-3">
      <div className="flex-1">
        <label className="mb-1.5 block text-sm font-medium text-ink">Fondo inicial</label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">$</span>
          <input type="number" min={0} className={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </div>
      </div>
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await abrirCaja(storeId, Number(amount) || 0);
            if (r.error) toast.error(r.error);
            else toast.success("Caja abierta.");
          })
        }
        className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        <Unlock className="h-4 w-4" />
        {pending ? "Abriendo…" : "Abrir caja"}
      </button>
    </div>
  );
}

function Cerrar({ row }: { row: CajaRow }) {
  const s = row.session!;
  const sum = row.summary;
  const [declared, setDeclared] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const diff = declared !== "" && sum ? Number(declared) - sum.expectedCash : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="text-muted">Abierta: <span className="text-ink">{formatDateTime(s.openedAt)}</span></span>
        <span className="text-muted">Fondo: <span className="text-ink">{formatMoney(s.openingAmount)}</span></span>
        <span className="text-muted">Ventas: <span className="text-ink">{sum?.sales ?? 0}</span></span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Vendido" value={formatMoney(sum?.sold ?? 0)} />
        <Tile label="Efectivo cobrado" value={formatMoney(sum?.cash ?? 0)} />
        <Tile label="Efectivo esperado" value={formatMoney(sum?.expectedCash ?? 0)} accent />
      </div>

      {sum && sum.byMethod.length > 0 && (
        <div className="rounded-lg border border-line px-4 py-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">Por medio de pago</div>
          {sum.byMethod.map((m) => (
            <div key={m.name} className="flex justify-between py-0.5 text-sm">
              <span className="text-muted">{m.name}</span>
              <span className="tabular-nums text-ink">{formatMoney(m.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-line pt-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Efectivo contado</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">$</span>
              <input type="number" min={0} className={input} value={declared} onChange={(e) => setDeclared(e.target.value)} placeholder="0" />
            </div>
            {diff !== null && (
              <p className={`mt-1.5 text-xs ${diff === 0 ? "text-ok" : "text-warn"}`}>
                {diff === 0 ? "Cuadra exacto" : `Diferencia: ${formatMoney(diff)}`}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Notas (opcional)</label>
            <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones del cierre" />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            disabled={pending || declared === ""}
            onClick={() =>
              start(async () => {
                const r = await cerrarCaja(s.id, Number(declared) || 0, notes);
                if (r.error) toast.error(r.error);
                else toast.success("Caja cerrada.");
              })
            }
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            <Lock className="h-4 w-4" />
            {pending ? "Cerrando…" : "Cerrar caja"}
          </button>
        </div>
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

export function CajaManager({ rows }: { rows: CajaRow[] }) {
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.id} className="rounded-xl border border-line bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted" />
            <h2 className="font-medium text-ink">{row.name}</h2>
            {row.session ? (
              <span className="ml-auto rounded-full bg-ok-bg px-2.5 py-0.5 text-xs font-medium text-ok">Turno abierto</span>
            ) : (
              <span className="ml-auto rounded-full bg-canvas px-2.5 py-0.5 text-xs font-medium text-muted">Cerrada</span>
            )}
          </div>
          {row.session ? <Cerrar row={row} /> : <Abrir storeId={row.id} />}
        </div>
      ))}
    </div>
  );
}
