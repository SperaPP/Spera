"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { loginPortal } from "../actions";

const input = "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export default function PortalLoginPage() {
  const [state, action, pending] = useActionState(loginPortal, {});
  useEffect(() => { if (state.error) toast.error(state.error); }, [state]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-8">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-fg">B</span>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Portal Mayorista</h1>
          <p className="mt-0.5 text-sm text-muted">Bodysculpt</p>
        </div>

        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className={input} />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">Contraseña</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className={input} />
          </div>
          <button type="submit" disabled={pending} className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
            {pending ? "Ingresando…" : "Ingresar"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm">
          <Link href="/portal/recuperar" className="text-muted hover:text-accent hover:underline">¿Olvidaste tu contraseña?</Link>
        </p>
        <p className="mt-2 text-center text-sm text-muted">
          ¿No tenés cuenta? <Link href="/portal/registro" className="font-medium text-accent hover:underline">Registrate</Link>
        </p>
      </div>
    </main>
  );
}
