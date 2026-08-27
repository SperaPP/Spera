import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresca la sesión en cada request y protege rutas.
 * Sin sesión → redirige a /login. Con sesión en /login → redirige al inicio.
 * (El middleware/proxy debe dejar pasar rutas públicas como los webhooks de
 * Tiendanube cuando se agreguen: si no, mueren con 307 hacia el login.)
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isStaffLogin = path === "/login" || path.startsWith("/login/");
  const isPortal = path === "/portal" || path.startsWith("/portal");
  const isPortalPublic = path.startsWith("/portal/login") || path.startsWith("/portal/registro") || path.startsWith("/portal/recuperar");
  // Recuperación de contraseña (personal y portal) y callback del mail.
  const isResetPublic = path.startsWith("/recuperar") || path.startsWith("/auth/") || path.startsWith("/nueva-contrasena");
  // Endpoints server-to-server de Tiendanube: llegan sin sesión y se protegen por
  // su cuenta (webhooks por HMAC; sync-stock por CRON_SECRET). No van al login.
  const isTnServerApi = path.startsWith("/api/tiendanube/webhooks") || path.startsWith("/api/tiendanube/sync-stock");

  if (!user) {
    // Público: login de personal, registro/login del portal, endpoints TN server.
    if (isStaffLogin || isPortalPublic || isResetPublic || isTnServerApi) return response;
    const url = request.nextUrl.clone();
    url.pathname = isPortal ? "/portal/login" : "/login";
    return NextResponse.redirect(url);
  }

  // Logueado en el login de personal → al inicio (el layout deriva a portal si es cliente).
  if (isStaffLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Gateo por módulo: acceso directo por URL a una pantalla requiere el permiso
  // de ver ese módulo (el sidebar ya oculta lo que no corresponde; esto cubre
  // el pegar la URL a mano). El orden importa: los prefijos más específicos primero.
  const MODULES: [string, string][] = [
    ["/stock/control", "control_stock"],
    ["/pos", "pos"], ["/ventas", "ventas"], ["/logistica", "logistica"], ["/reposiciones", "reposiciones"],
    ["/productos", "productos"], ["/etiquetas", "productos"],
    ["/stock", "stock"], ["/transferencias", "transferencias"],
    ["/clientes", "clientes"], ["/precios", "precios"], ["/caja", "caja"],
    ["/cobranzas", "cobranzas"], ["/reportes", "reportes"], ["/configuracion", "configuracion"],
  ];
  const gated = MODULES.find(([prefix]) => path === prefix || path.startsWith(prefix + "/"));
  if (gated) {
    const { data: perms } = await supabase.rpc("get_my_permissions");
    const p = (perms ?? {}) as Record<string, { view?: boolean }>;
    if (p[gated[1]]?.view !== true) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
