// Orden lógico de talles (numérico o letra), no alfabético. Compartido server/client.
const SIZE_RANK: Record<string, number> = { U: 0, "ÚNICO": 0, UNICO: 0, UNICA: 0, XS: 1, S: 2, M: 3, L: 4, XL: 5, XXL: 6, XXXL: 7, XXXXL: 8 };

export function sizeCmp(a: string, b: string): number {
  const na = Number(a), nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  const ra = SIZE_RANK[a.toUpperCase()], rb = SIZE_RANK[b.toUpperCase()];
  if (ra != null && rb != null) return ra - rb;
  if (ra != null) return -1;
  if (rb != null) return 1;
  return a.localeCompare(b, "es");
}
