"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserCircle, KeyRound, X, Crown } from "lucide-react";
import { asignarRol, asignarSucursal, resetearPassword, setCajaTitular } from "@/app/(app)/usuarios/actions";

type User = { id: string; email: string; name: string; roleId: string | null; storeId: string | null; isCashTitular: boolean };
type Role = { id: string; name: string };
type Store = { id: string; name: string };

const select =
  "rounded-lg border border-line-strong bg-card px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function UsuariosManager({ users, roles, stores }: { users: User[]; roles: Role[]; stores: Store[] }) {
  const [pending, start] = useTransition();
  const [resetId, setResetId] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [titular, setTitular] = useState<Record<string, boolean>>(() => Object.fromEntries(users.map((u) => [u.id, u.isCashTitular])));

  function toggleTitular(userId: string, value: boolean) {
    setTitular((t) => ({ ...t, [userId]: value }));
    start(async () => {
      const r = await setCajaTitular(userId, value);
      if (r.error) { toast.error(r.error); setTitular((t) => ({ ...t, [userId]: !value })); }
      else toast.success(value ? "Marcado como cajero titular" : "Ya no es cajero titular");
    });
  }

  function assign(userId: string, roleId: string) {
    start(async () => {
      const r = await asignarRol(userId, roleId || null);
      if (r.error) toast.error(r.error); else toast.success("Rol asignado");
    });
  }

  function assignStore(userId: string, storeId: string) {
    start(async () => {
      const r = await asignarSucursal(userId, storeId || null);
      if (r.error) toast.error(r.error); else toast.success("Sucursal asignada");
    });
  }

  function doReset(userId: string) {
    if (pass.length < 6) return toast.error("Mínimo 6 caracteres.");
    start(async () => {
      const r = await resetearPassword(userId, pass);
      if (r.error) { toast.error(r.error); return; }
      toast.success("Contraseña actualizada.");
      setResetId(null); setPass("");
    });
  }

  return (
    <div className="rounded-xl border border-line bg-card">
      <div>
        {users.map((u) => (
          <div key={u.id} className="border-b border-line px-4 py-3 last:border-0">
            <div className="flex items-center gap-3">
              <UserCircle className="h-8 w-8 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{u.name || u.email}</div>
                {u.name && <div className="truncate text-xs text-muted">{u.email}</div>}
              </div>
              <button
                onClick={() => toggleTitular(u.id, !titular[u.id])}
                disabled={pending}
                title={titular[u.id] ? "Cajero titular (puede abrir la caja titular del local)" : "Marcar como cajero titular"}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${titular[u.id] ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:bg-canvas"}`}
              >
                <Crown className="h-3.5 w-3.5" /> Titular
              </button>
              <button
                onClick={() => { setResetId(resetId === u.id ? null : u.id); setPass(""); }}
                title="Cambiar contraseña"
                className="rounded-md p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink"
              >
                <KeyRound className="h-4 w-4" />
              </button>
              <select value={u.storeId ?? ""} onChange={(e) => assignStore(u.id, e.target.value)} disabled={pending} className={select} title="Sucursal asignada">
                <option value="">Sin sucursal</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={u.roleId ?? ""} onChange={(e) => assign(u.id, e.target.value)} disabled={pending} className={select} title="Rol">
                <option value="">Sin rol</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>

            {resetId === u.id && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-canvas p-2">
                <input
                  type="text"
                  autoFocus
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") doReset(u.id); }}
                  placeholder="Nueva contraseña (mín. 6)"
                  className="flex-1 rounded-lg border border-line-strong bg-card px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
                />
                <button onClick={() => doReset(u.id)} disabled={pending} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">Guardar</button>
                <button onClick={() => { setResetId(null); setPass(""); }} className="rounded-md p-1.5 text-muted hover:text-ink"><X className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-1 border-t border-line px-4 py-3">
        <p className="text-xs text-muted"><span className="inline-flex items-center gap-1 font-medium text-ink"><Crown className="h-3 w-3" /> Titular</span>: puede abrir la caja titular del local (maneja caja chica, cierre y reparto). Los demás solo abren cajas de apoyo, y únicamente si ya hay una titular abierta.</p>
        <p className="text-xs text-muted">Para sumar un usuario nuevo usá <span className="font-medium text-ink">Nuevo usuario</span> arriba. Acá podés cambiarle el rol, la sucursal, marcar cajero titular o resetear la contraseña.</p>
      </div>
    </div>
  );
}
