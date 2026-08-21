"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus, Crown, ChevronDown } from "lucide-react";
import { crearUsuario } from "@/app/(app)/usuarios/actions";

type Role = { id: string; name: string };
type Store = { id: string; name: string };

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";
const label = "mb-1 block text-xs font-medium text-muted";

export function NuevoUsuarioForm({ roles, stores }: { roles: Role[]; stores: Store[] }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [titular, setTitular] = useState(false);
  const [pending, start] = useTransition();

  function reset() { setEmail(""); setPassword(""); setFullName(""); setRoleId(""); setStoreId(""); setTitular(false); }

  function submit() {
    if (!email.trim()) return toast.error("Ingresá el email.");
    if (password.length < 6) return toast.error("La contraseña debe tener al menos 6 caracteres.");
    start(async () => {
      const r = await crearUsuario({
        email, password, fullName,
        roleId: roleId || null, storeId: storeId || null, isCashTitular: titular,
      });
      if (r.error) { toast.error(r.error); return; }
      toast.success("Usuario creado."); reset(); setOpen(false);
    });
  }

  return (
    <div className="mb-4 rounded-xl border border-line bg-card">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-ink">
        <UserPlus className="h-4 w-4 text-accent" /> Nuevo usuario
        <ChevronDown className={`ml-auto h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-line p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Email (usuario de acceso)</label>
              <input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="persona@bodysculpt.com" />
            </div>
            <div>
              <label className={label}>Contraseña inicial (mín. 6)</label>
              <input type="text" className={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="La puede cambiar después" />
            </div>
            <div>
              <label className={label}>Nombre y apellido</label>
              <input className={input} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Juan Pérez" />
            </div>
            <div>
              <label className={label}>Rol</label>
              <select className={input} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">Sin rol (asignar después)</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Sucursal</label>
              <select className={input} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Sin sucursal</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={titular} onChange={(e) => setTitular(e.target.checked)} className="h-4 w-4 accent-[color:var(--color-accent)]" />
                <Crown className="h-3.5 w-3.5 text-accent" /> Cajero titular
              </label>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => { reset(); setOpen(false); }} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">Cancelar</button>
            <button onClick={submit} disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
              {pending ? "Creando…" : "Crear usuario"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">Se crea la cuenta de acceso y su perfil. El usuario entra con ese email y contraseña; después puede cambiarla.</p>
        </div>
      )}
    </div>
  );
}
