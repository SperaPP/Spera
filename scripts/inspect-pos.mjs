// Diagnóstico SOLO LECTURA del estado del POS tras 0021.
//   node --env-file=.env.local scripts/inspect-pos.mjs
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log("=== payment_methods ===");
const { data: pm, error: e1 } = await sb.from("payment_methods").select("name, kind, active, affects_cash").order("position");
if (e1) console.log("ERROR:", e1.message);
for (const m of pm ?? []) console.log(`  ${m.name}  [${m.kind}]  active=${m.active} cash=${m.affects_cash}`);

console.log("\n=== stores (is_wholesale) ===");
const { data: st, error: e2 } = await sb.from("stores").select("name, is_wholesale, has_cash_register").order("name");
if (e2) console.log("ERROR:", e2.message);
for (const s of st ?? []) console.log(`  ${s.name}  wholesale=${s.is_wholesale}  caja=${s.has_cash_register}`);

console.log("\n=== sales: columnas snapshot presentes? ===");
const { error: e3 } = await sb.from("sales").select("id, customer_name, customer_doc, customer_phone, customer_email, coupon_id").limit(1);
console.log(e3 ? `  ERROR: ${e3.message}` : "  OK: columnas snapshot + coupon_id existen");

console.log("\n=== probe create_sale firma (dry, sin ítems → debe decir 'no tiene ítems' si la firma nueva existe) ===");
const { error: e4 } = await sb.rpc("create_sale", {
  p_store_id: "00000000-0000-0000-0000-000000000000",
  p_cash_session_id: "00000000-0000-0000-0000-000000000000",
  p_customer_id: null, p_price_list_id: null, p_coupon_id: null,
  p_customer_data: null, p_items: [], p_payments: [],
});
console.log("  respuesta:", e4 ? e4.message : "(sin error?!)");
