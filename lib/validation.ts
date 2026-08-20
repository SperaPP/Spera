// Validaciones simples de contacto, usables en server y client.

export function isValidEmail(v: string): boolean {
  const s = v.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Solo los dígitos de un teléfono (descarta +, espacios, guiones, paréntesis). */
export function phoneDigits(v: string): string {
  return v.replace(/\D/g, "");
}

/** Teléfono válido: entre 8 y 15 dígitos (cubre fijo con característica y celular con/ sin país). */
export function isValidPhone(v: string): boolean {
  const d = phoneDigits(v);
  return d.length >= 8 && d.length <= 15;
}
