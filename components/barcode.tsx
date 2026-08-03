"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

/** Código de barras CODE39 que llena el ancho del contenedor, con alto en mm. */
export function Barcode({ value, heightMm = 10 }: { value: string; heightMm?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !value) return;
    try {
      JsBarcode(svg, value, { format: "CODE39", displayValue: false, margin: 0, height: 60, width: 2 });
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
  return <svg ref={ref} style={{ width: "100%", height: `${heightMm}mm`, display: "block" }} />;
}
