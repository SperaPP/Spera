import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RolesManager } from "@/components/roles-manager";
import { UsuariosManager } from "@/components/usuarios-manager";

export default async function UsuariosPage() {
  const sb = await createClient();
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  const [{ data: roles }, { data: perms }, { data: profiles }, { data: stores }] = await Promise.all([
    sb.from("roles").select("id, name").order("name"),
    sb.from("role_permissions").select("role_id, module, can_view, can_edit"),
    sb.from("profiles").select("id, email, full_name, role_id, store_id").order("email"),
    sb.from("stores").select("id, name").eq("active", true).order("name"),
  ]);

  const permsByRole: Record<string, Record<string, { view: boolean; edit: boolean }>> = {};
  for (const p of perms ?? []) {
    (permsByRole[p.role_id] ??= {})[p.module] = { view: p.can_view, edit: p.can_edit };
  }

  const users = (profiles ?? []).map((p) => ({
    id: p.id, email: p.email ?? "", name: p.full_name ?? "", roleId: p.role_id as string | null,
    storeId: (p.store_id as string | null) ?? null,
  }));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Usuarios y roles</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Definí qué puede ver y editar cada rol, y asigná roles a los usuarios.</p>

      <RolesManager roles={roles ?? []} permsByRole={permsByRole} />

      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-wide text-faint">Usuarios</h2>
      <UsuariosManager users={users} roles={roles ?? []} stores={stores ?? []} />
    </div>
  );
}
