"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { setClavePortal } from "../actions";

const input = "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export default function PortalNuevaClavePage() {
  const [state, action, pending] = useActionState(setClavePortal, {});
  useEffect(() => { if (state.error) toast.error(state.error); }, [state]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-8">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Creá tu contraseña</h1>
          <p className="mt-1 text-sm text-muted">Portal Mayorista · Body Sculpt</p>
        </div>

        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">Contraseña (mín. 6)</label>
            <input id="password" name="password" type="password" autoComplete="new-password" required className={input} placeholder="Elegí una contraseña" />
          </div>
          <button type="submit" disabled={pending} className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
            {pending ? "Guardando…" : "Guardar y entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
