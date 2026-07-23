// Helpers puros de permisos (usables en server y client).
// Gatear SIEMPRE por permiso de módulo, no por nombre de rol.
// Excepción: acciones destructivas → is_admin() dentro de la función SQL.

export type Perms = Record<string, { view: boolean; edit: boolean }>;

export function canView(perms: Perms, module: string): boolean {
  return perms[module]?.view === true;
}

export function canEdit(perms: Perms, module: string): boolean {
  return perms[module]?.edit === true;
}
