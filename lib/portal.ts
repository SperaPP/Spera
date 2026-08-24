import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type PortalCustomer = {
  id: string;
  name: string;
  email: string | null;
  portalStatus: "pendiente" | "aprobado" | "rechazado" | null;
  balance: number;
  priceListId: string | null;
  organizationId: string;
};

/**
 * Cliente del portal logueado. Los usuarios del portal NO tienen perfil de
 * empleado, así que la RLS interna (current_org_id) no aplica → leemos el
 * customer con service-role, ligado por auth_user_id.
 */
export async function getPortalCustomer(): Promise<{ userId: string | null; customer: PortalCustomer | null }> {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return { userId: null, customer: null };

  const admin = createAdminClient();
  const { data: c } = await admin
    .from("customers")
    .select("id, name, email, portal_status, balance, organization_id, customer_types(price_list_id)")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  if (!c) return { userId: auth.user.id, customer: null };

  const ct = Array.isArray(c.customer_types) ? c.customer_types[0] : c.customer_types;
  return {
    userId: auth.user.id,
    customer: {
      id: c.id, name: c.name, email: c.email,
      portalStatus: c.portal_status as PortalCustomer["portalStatus"],
      balance: Number(c.balance),
      priceListId: (ct as { price_list_id: string | null } | null)?.price_list_id ?? null,
      organizationId: c.organization_id,
    },
  };
}
