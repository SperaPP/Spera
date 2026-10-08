// Mapa de nombre de color (texto libre, en español) → hex, para mostrar swatches.
// Si un color no se reconoce, devolvemos null y la UI muestra un swatch neutro.
const MAP: Record<string, string> = {
  negro: "#111111", black: "#111111",
  blanco: "#ffffff", white: "#ffffff", crudo: "#f3ece0", hueso: "#eae6da", marfil: "#f6f2e7", tiza: "#f4f4f2", offwhite: "#f4f2ec",
  gris: "#9ca3af", grismelange: "#b9bdc4", grisclaro: "#c9ced6", grisoscuro: "#4b5563", plomo: "#6b7280", plata: "#cbd5e1",
  rojo: "#dc2626", red: "#dc2626", teja: "#b45336", ladrillo: "#9c4a2f", coral: "#ff6f5e", tomate: "#e54b35",
  bordo: "#6d1a2a", bordó: "#6d1a2a", vino: "#5e1626", marsala: "#7a303a", frambuesa: "#b01b55",
  rosa: "#f472b6", rosaviejo: "#c97b84", rosapastel: "#f7c6d9", paloderosa: "#d6a0a0", fucsia: "#d6219b", chicle: "#ff5fa2",
  violeta: "#8b5cf6", lila: "#b79cf0", purpura: "#7c3aed", púrpura: "#7c3aed", lavanda: "#c4b5fd", uva: "#5b2a86",
  azul: "#2563eb", blue: "#2563eb", azulmarino: "#1e2a52", marino: "#1e2a52", navy: "#1e2a52", petroleo: "#145c63", petróleo: "#145c63", francia: "#2f6fd1",
  celeste: "#5bb8ec", cielo: "#8ccdf0", aqua: "#38bdf8", turquesa: "#16b8a6",
  verde: "#16a34a", green: "#16a34a", verdemilitar: "#4b5320", militar: "#4b5320", oliva: "#808000", verdeagua: "#8fd0bf", menta: "#9fe0c4", manzana: "#4fae3b", botella: "#13452f", loro: "#4caf2f",
  amarillo: "#f5c518", yellow: "#f5c518", mostaza: "#d4a017", oro: "#d4af37", dorado: "#d4af37", maiz: "#f3cf5c",
  naranja: "#f97316", orange: "#f97316", mandarina: "#f98029", salmon: "#fa8a72", salmón: "#fa8a72", durazno: "#ffb27a",
  marron: "#78461f", marrón: "#78461f", cafe: "#6f4e37", café: "#6f4e37", chocolate: "#4e342e", tabaco: "#8a5a2b", camel: "#c19a6b", beige: "#e3d5bd", arena: "#dfd0ae", nude: "#e3bc9a", tostado: "#b98b56", caramelo: "#b5753b", cobre: "#b06b43",
  animal: "#caa472", leopardo: "#caa472", print: "#caa472", estampado: "#caa472", floral: "#caa472", rayado: "#caa472",
};

function norm(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
}

/** Devuelve el hex de un color por su nombre, o null si no se reconoce. */
export function colorHex(name: string): string | null {
  const n = norm(name);
  if (MAP[n]) return MAP[n];
  // match por prefijo/contenido (ej. "azul noche" → azul, "verde seco" → verde)
  for (const key of Object.keys(MAP)) {
    if (n.startsWith(key) || n.includes(key)) return MAP[key];
  }
  return null;
}

/** ¿El color sugiere un estampado/multicolor? (para dibujar un swatch especial) */
export function isPrint(name: string): boolean {
  const n = norm(name);
  return ["animal", "leopardo", "print", "estampado", "floral", "rayado", "multicolor", "varios"].some((k) => n.includes(k));
}
