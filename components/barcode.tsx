"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/** Código de barras CODE128 que llena el ancho del contenedor.
 *  Compacto y robusto (mejor que CODE39 en etiquetas chicas). fill=true: además
 *  llena el alto disponible (el padre controla la altura). */
export function Barcode({ value, heightMm = 10, fill = false }: { value: string; heightMm?: number; fill?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !value) return;
    try {
      JsBarcode(svg, value, { format: "CODE128", displayValue: false, margin: 0, height: 60, width: 2 });
      const w = svg.getAttribute("width");
      const h = svg.getAttribute("height");
      if (w && h) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("preserveAspectRatio", "none");
      svg.removeAttribute("width");
      svg.removeAttribute("height");
    } catch {
      /* valor no codificable */
    }
  }, [value]);
  return <svg ref={ref} style={{ width: "100%", height: fill ? "100%" : `${heightMm}mm`, display: "block" }} />;
}
