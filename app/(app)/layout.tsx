import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPermissions } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { logout } from "./actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, perms, { data: isAdmin }] = await Promise.all([
    sb.from("profiles").select("full_name, email").eq("id", user.id).single(),
    getPermissions(),
    sb.rpc("is_admin"),
  ]);

  const displayName = profile?.full_name || profile?.email || user.email;

  const initials = (displayName ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="flex min-h-screen">
      <Sidebar perms={perms} isAdmin={!!isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-3 border-b border-line bg-card px-6 print:hidden">
          <span className="text-sm text-muted">{displayName}</span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-xs font-medium text-accent">
            {initials}
          </span>
          <form action={logout}>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              <LogOut className="h-4 w-4" />
              Salir
            </button>
          </form>
        </header>
        <main className="min-w-0 flex-1 p-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}
