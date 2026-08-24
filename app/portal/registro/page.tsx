"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { registrarPortal } from "../actions";

const input = "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";
const label = "mb-1.5 block text-sm font-medium text-ink";

export default function PortalRegistroPage() {
  const [state, action, pending] = useActionState(registrarPortal, {});
  useEffect(() => { if (state.error) toast.error(state.error); }, [state]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-8">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Registro mayorista</h1>
          <p className="mt-1 text-sm text-muted">Creá tu cuenta. La habilitamos tras revisarla.</p>
        </div>

        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="name" className={label}>Razón social / Nombre</label>
            <input id="name" name="name" required className={input} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="docType" className={label}>Tipo</label>
              <select id="docType" name="docType" className={input} defaultValue="CUIT">
                <option value="CUIT">CUIT</option>
                <option value="DNI">DNI</option>
                <option value="CUIL">CUIL</option>
              </select>
            </div>
            <div className="col-span-2">
              <label htmlFor="docNumber" className={label}>Número</label>
              <input id="docNumber" name="docNumber" required className={input} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="email" className={label}>Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required className={input} />
            </div>
            <div>
              <label htmlFor="phone" className={label}>Teléfono</label>
              <input id="phone" name="phone" className={input} />
            </div>
          </div>
          <div>
            <label htmlFor="password" className={label}>Contraseña (mín. 6)</label>
            <input id="password" name="password" type="password" autoComplete="new-password" required className={input} />
          </div>
          <button type="submit" disabled={pending} className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
            {pending ? "Creando cuenta…" : "Crear cuenta"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-muted">
          ¿Ya tenés cuenta? <Link href="/portal/login" className="font-medium text-accent hover:underline">Ingresá</Link>
        </p>
      </div>
    </main>
  );
}
