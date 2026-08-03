import { createClient } from "@/lib/supabase/server";
import { CambiarPasswordForm } from "@/components/cambiar-password-form";

export default async function CuentaPage() {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  const { data: profile } = await sb
    .from("profiles")
    .select("full_name, email, roles(name)")
    .eq("id", auth?.user?.id ?? "")
    .maybeSingle();

  const roleName = (() => {
    const r = profile?.roles as { name: string } | { name: string }[] | null;
    return (Array.isArray(r) ? r[0]?.name : r?.name) ?? "Sin rol";
  })();

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Mi cuenta</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Tus datos y tu contraseña.</p>

      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="text-sm">
          <span className="text-muted">Email: </span>
          <span className="text-ink">{profile?.email ?? auth?.user?.email}</span>
        </div>
        {profile?.full_name && (
          <div className="mt-1 text-sm"><span className="text-muted">Nombre: </span><span className="text-ink">{profile.full_name}</span></div>
        )}
        <div className="mt-1 text-sm"><span className="text-muted">Rol: </span><span className="text-ink">{roleName}</span></div>
      </div>

      <div className="rounded-xl border border-line bg-card p-5">
        <h2 className="mb-4 text-sm font-medium text-ink">Cambiar contraseña</h2>
        <CambiarPasswordForm />
      </div>
    </div>
  );
}
