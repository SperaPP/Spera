// Helpers puros de permisos (usables en server y client).
// Gatear SIEMPRE por permiso de módulo, no por nombre de rol.
// Excepción: acciones destructivas → is_admin() dentro de la función SQL.

export type Perms = Record<string, { view: boolean; edit: boolean }>;

/** Módulos gateables por permiso (para la matriz de roles). */
export const MODULES: { key: string; label: string }[] = [
  { key: "pos", label: "Punto de venta" },
  { key: "ventas", label: "Ventas" },
  { key: "logistica", label: "Logística" },
  { key: "productos", label: "Productos" },
  { key: "stock", label: "Stock" },
  { key: "control_stock", label: "Control de stock" },
  { key: "transferencias", label: "Transferencias" },
  { key: "clientes", label: "Clientes" },
  { key: "precios", label: "Precios" },
  { key: "caja", label: "Caja" },
  { key: "cobranzas", label: "Cobranzas" },
  { key: "reportes", label: "Reportes" },
  { key: "configuracion", label: "Configuración" },
  { key: "tiendanube", label: "Tiendanube" },
];

export function canView(perms: Perms, module: string): boolean {
  return perms[module]?.view === true;
}

export function canEdit(perms: Perms, module: string): boolean {
  return perms[module]?.edit === true;
}
