"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { UserCircle } from "lucide-react";
import { asignarRol } from "@/app/(app)/usuarios/actions";

type User = { id: string; email: string; name: string; roleId: string | null };
type Role = { id: string; name: string };

const select =
  "rounded-lg border border-line-strong bg-card px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";

export function UsuariosManager({ users, roles }: { users: User[]; roles: Role[] }) {
  const [pending, start] = useTransition();

  function assign(userId: string, roleId: string) {
    start(async () => {
      const r = await asignarRol(userId, roleId || null);
      if (r.error) toast.error(r.error); else toast.success("Rol asignado");
    });
  }

  return (
    <div className="rounded-xl border border-line bg-card">
      <div>
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
            <UserCircle className="h-8 w-8 shrink-0 text-faint" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{u.name || u.email}</div>
              {u.name && <div className="truncate text-xs text-muted">{u.email}</div>}
            </div>
            <select value={u.roleId ?? ""} onChange={(e) => assign(u.id, e.target.value)} disabled={pending} className={select}>
              <option value="">Sin rol</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="border-t border-line px-4 py-3">
        <p className="text-xs text-muted">
          Para sumar un usuario nuevo: crealo en Supabase (Authentication → Add user) y después asignale el rol acá.
        </p>
      </div>
    </div>
  );
}
