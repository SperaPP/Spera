"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ticket, Plus } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { crearCupon, toggleCupon } from "@/app/(app)/configuracion/actions";

type Coupon = {
  id: string; code: string; discount_type: "percent" | "amount"; discount_value: number;
  min_amount: number | null; max_uses: number | null; used_count: number; expires_at: string | null; active: boolean;
};

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";
const label = "mb-1 block text-xs font-medium text-muted";

export function CuponesManager({ coupons }: { coupons: Coupon[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expires, setExpires] = useState("");

  function crear() {
    if (!code.trim()) return toast.error("Ingresá un código.");
    if (!(Number(value) > 0)) return toast.error("Ingresá un valor de descuento.");
    start(async () => {
      const r = await crearCupon({
        code: code.trim(),
        discountType: type,
        discountValue: Number(value),
        minAmount: minAmount.trim() ? Number(minAmount) : null,
        maxUses: maxUses.trim() ? Number(maxUses) : null,
        expiresAt: expires || null,
      });
      if (r.error) { toast.error(r.error); return; }
      toast.success("Cupón creado.");
      setCode(""); setValue(""); setMinAmount(""); setMaxUses(""); setExpires("");
      router.refresh();
    });
  }

  function toggle(c: Coupon) {
    start(async () => {
      const r = await toggleCupon(c.id, !c.active);
      if (r.error) toast.error(r.error); else router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Ticket className="h-4 w-4 text-muted" />
        <h3 className="text-sm font-medium text-ink">Cupones de descuento</h3>
      </div>
      <p className="mb-4 text-xs text-muted">Se aplican en el punto de venta (mostrador), uno por venta. El precio del vendedor está bloqueado: el descuento es solo por cupón.</p>

      {/* Alta */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 sm:col-span-1">
          <label className={label}>Código</label>
          <input className={`${input} uppercase`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="VERANO10" />
        </div>
        <div>
          <label className={label}>Tipo</label>
          <select className={input} value={type} onChange={(e) => setType(e.target.value as "percent" | "amount")}>
            <option value="percent">%</option>
            <option value="amount">$ fijo</option>
          </select>
        </div>
        <div>
          <label className={label}>Valor</label>
          <input type="number" min={0} className={input} value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === "percent" ? "10" : "5000"} />
        </div>
        <div>
          <label className={label}>Mínimo (opc.)</label>
          <input type="number" min={0} className={input} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="—" />
        </div>
        <div>
          <label className={label}>Usos máx. (opc.)</label>
          <input type="number" min={1} className={input} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="—" />
        </div>
        <div>
          <label className={label}>Vence (opc.)</label>
          <input type="date" className={input} value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <button onClick={crear} disabled={pending} className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
          <Plus className="h-4 w-4" /> Crear cupón
        </button>
      </div>

      {/* Lista */}
      {coupons.length > 0 && (
        <div className="mt-5 divide-y divide-line rounded-lg border border-line">
          {coupons.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
              <span className="font-mono font-medium text-ink">{c.code}</span>
              <span className="text-muted">
                {c.discount_type === "percent" ? `${c.discount_value}%` : formatMoney(c.discount_value)}
              </span>
              {c.min_amount != null && <span className="text-xs text-muted">mín. {formatMoney(c.min_amount)}</span>}
              <span className="text-xs text-muted">
                usos: {c.used_count}{c.max_uses != null ? ` / ${c.max_uses}` : ""}
              </span>
              {c.expires_at && <span className="text-xs text-muted">vence {c.expires_at}</span>}
              <button
                onClick={() => toggle(c)}
                disabled={pending}
                title={c.active ? "Desactivar" : "Activar"}
                className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors hover:opacity-80 ${c.active ? "bg-ok-bg text-ok" : "bg-canvas text-muted"}`}
              >
                {c.active ? "Activo" : "Inactivo"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
