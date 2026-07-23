// Formateo localizado es-AR. Toda la plata es ARS (no hay multimoneda).
// Lección de la base: el server corre en UTC → fijar SIEMPRE la zona local
// al formatear timestamptz y al calcular "hoy", si no todo se muestra corrido.

export const TZ = "America/Argentina/Buenos_Aires";

const moneyFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

const numberFmt = new Intl.NumberFormat("es-AR");

/** $ 1.234,56 */
export function formatMoney(value: number | string): string {
  return moneyFmt.format(typeof value === "string" ? Number(value) : value);
}

/** 1.234 */
export function formatNumber(value: number | string): string {
  return numberFmt.format(typeof value === "string" ? Number(value) : value);
}

/** Para columnas `timestamptz`: convierte a hora local de Buenos Aires. */
export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Para columnas `timestamptz` cuando solo interesa el día. */
export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

/**
 * Para columnas `date` (día calendario puro, ej. fecha de nacimiento):
 * mostrar tal cual, SIN convertir zona, para no correr un día.
 */
export function formatCalendarDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** "Hoy" en zona local (YYYY-MM-DD), para filtros de caja/cierres. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
