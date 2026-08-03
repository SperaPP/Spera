"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { crearCliente } from "@/app/(app)/clientes/actions";

type CustomerType = { id: string; name: string; defaultFiscal: string; priceListName: string | null };
type Fiscal = "consumidor_final" | "responsable_inscripto" | "monotributo" | "exento";

const FISCAL: { value: Fiscal; label: string }[] = [
  { value: "consumidor_final", label: "Consumidor Final" },
  { value: "responsable_inscripto", label: "Responsable Inscripto" },
  { value: "monotributo", label: "Monotributo" },
  { value: "exento", label: "Exento" },
];

const input =
  "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25";
const label = "mb-1.5 block text-sm font-medium text-ink";

export function NuevoClienteForm({ customerTypes }: { customerTypes: CustomerType[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState(customerTypes[0]?.id ?? "");
  const [fiscal, setFiscal] = useState<Fiscal>((customerTypes[0]?.defaultFiscal as Fiscal) ?? "consumidor_final");
  const [docType, setDocType] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  function onTypeChange(id: string) {
    setTypeId(id);
    const t = customerTypes.find((x) => x.id === id);
    if (t) setFiscal(t.defaultFiscal as Fiscal);
  }

  function submit() {
    if (!name.trim()) return toast.error("Ingresá un nombre.");
    start(async () => {
      const res = await crearCliente({
        name: name.trim(),
        customerTypeId: typeId || null,
        fiscalCondition: fiscal,
        docType: docType || undefined,
        docNumber: docNumber || undefined,
        email: email || undefined,
        phone: phone || undefined,
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success("Cliente creado.");
      router.push("/clientes");
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-card p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="name">Nombre / Razón social</label>
            <input id="name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Boutique Las Flores" />
          </div>
          <div>
            <label className={label} htmlFor="type">Tipo de cliente</label>
            <select id="type" className={input} value={typeId} onChange={(e) => onTypeChange(e.target.value)}>
              {customerTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.priceListName ? ` · ${t.priceListName}` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="fiscal">Condición fiscal</label>
            <select id="fiscal" className={input} value={fiscal} onChange={(e) => setFiscal(e.target.value as Fiscal)}>
              {FISCAL.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="docType">Tipo de documento</label>
            <select id="docType" className={input} value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="">—</option>
              <option value="DNI">DNI</option>
              <option value="CUIT">CUIT</option>
              <option value="CUIL">CUIL</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="docNumber">Número</label>
            <input id="docNumber" className={input} value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="20-12345678-9" />
          </div>
          <div>
            <label className={label} htmlFor="email">Email</label>
            <input id="email" type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@mail.com" />
          </div>
          <div>
            <label className={label} htmlFor="phone">Teléfono</label>
            <input id="phone" className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 5555-5555" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push("/clientes")}
          className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {pending ? "Creando…" : "Crear cliente"}
        </button>
      </div>
    </div>
  );
}
