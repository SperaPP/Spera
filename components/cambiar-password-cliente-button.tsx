"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { KeyRound, X } from "lucide-react";
import { cambiarPasswordCliente } from "@/app/(app)/clientes/actions";

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function CambiarPasswordClienteButton({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [pending, start] = useTransition();

  function guardar() {
    if (pass.length < 6) return toast.error("Mínimo 6 caracteres.");
    start(async () => {
      const r = await cambiarPasswordCliente(customerId, pass);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Contraseña del portal actualizada.");
      setOpen(false); setPass("");
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas">
        <KeyRound className="h-4 w-4" /> Cambiar contraseña
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Cambiar contraseña del portal</h2>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-muted">Le ponés una contraseña nueva para que entre al portal mayorista. Pasásela al cliente por un canal seguro; conviene que la cambie después.</p>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-muted">Nueva contraseña (mínimo 6)</label>
              <input
                type="text" autoFocus className={input} value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") guardar(); }}
                placeholder="Escribí la contraseña nueva"
              />
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
              <button onClick={guardar} disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
                {pending ? "Guardando…" : "Cambiar contraseña"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
