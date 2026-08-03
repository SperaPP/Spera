"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODULES } from "@/lib/permissions";
import { crearRol, setPermiso } from "@/app/(app)/usuarios/actions";

type Role = { id: string; name: string };
type Perm = { view: boolean; edit: boolean };
type PermsByRole = Record<string, Record<string, Perm>>;

const input =
  "rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function RolesManager({ roles, permsByRole }: { roles: Role[]; permsByRole: PermsByRole }) {
  const [selected, setSelected] = useState(roles[0]?.id ?? "");
  const [local, setLocal] = useState<PermsByRole>(permsByRole);
  const [newRole, setNewRole] = useState("");
  const [pending, start] = useTransition();

  const role = roles.find((r) => r.id === selected);
  const isSuper = role?.name === "SuperAdministrador";

  const get = (roleId: string, mod: string): Perm => local[roleId]?.[mod] ?? { view: false, edit: false };

  function change(mod: string, view: boolean, edit: boolean) {
    if (edit) view = true;
    if (!view) edit = false;
    setLocal((prev) => ({ ...prev, [selected]: { ...(prev[selected] ?? {}), [mod]: { view, edit } } }));
    start(async () => {
      const r = await setPermiso(selected, mod, view, edit);
      if (r.error) toast.error(r.error);
    });
  }

  function addRole() {
    if (!newRole.trim()) return;
    start(async () => {
      const r = await crearRol(newRole.trim());
      if (r.error) { toast.error(r.error); return; }
      toast.success("Rol creado"); setNewRole("");
    });
  }

  return (
    <div className="rounded-xl border border-line bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        {roles.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className={cn("rounded-lg px-3 py-1.5 text-sm transition-colors", selected === r.id ? "bg-accent font-medium text-accent-fg" : "text-muted hover:bg-canvas hover:text-ink")}
          >
            {r.name}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <input className={`${input} w-40 py-1.5`} value={newRole} onChange={(e) => setNewRole(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addRole(); }} placeholder="Nuevo rol" />
          <button onClick={addRole} disabled={pending || !newRole.trim()} className="flex items-center rounded-lg bg-accent px-2.5 py-1.5 text-accent-fg hover:bg-accent-hover disabled:opacity-60"><Plus className="h-4 w-4" /></button>
        </div>
      </div>

      {isSuper ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted">
          <ShieldCheck className="h-5 w-5 text-accent" />
          El rol <span className="font-medium text-ink">SuperAdministrador</span> tiene acceso total y no se edita.
        </div>
      ) : !role ? (
        <p className="px-4 py-8 text-center text-sm text-muted">Creá un rol para configurar sus permisos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-medium">Módulo</th>
                <th className="px-4 py-2.5 text-center font-medium">Ver</th>
                <th className="px-4 py-2.5 text-center font-medium">Editar</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((m) => {
                const p = get(selected, m.key);
                return (
                  <tr key={m.key} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 text-ink">{m.label}</td>
                    <td className="px-4 py-2 text-center">
                      <input type="checkbox" checked={p.view} onChange={(e) => change(m.key, e.target.checked, p.edit)} className="h-4 w-4 accent-[color:var(--color-accent)]" />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <input type="checkbox" checked={p.edit} onChange={(e) => change(m.key, p.view, e.target.checked)} className="h-4 w-4 accent-[color:var(--color-accent)]" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
