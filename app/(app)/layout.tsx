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

  const [{ data: profile }, perms] = await Promise.all([
    sb.from("profiles").select("full_name, email").eq("id", user.id).single(),
    getPermissions(),
  ]);

  const displayName = profile?.full_name || profile?.email || user.email;

  return (
    <div className="flex min-h-screen">
      <Sidebar perms={perms} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-6">
          <div />
          <div className="flex items-center gap-4">
            <span className="text-sm text-neutral-600">{displayName}</span>
            <form action={logout}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100"
              >
                <LogOut className="h-4 w-4" />
                Salir
              </button>
            </form>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
