"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCan, type ActionState } from "@/lib/auth";

const BUCKET = "product-images";

export async function subirFoto(formData: FormData): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const file = formData.get("file") as File | null;
  const productId = String(formData.get("productId") ?? "");
  const color = (String(formData.get("color") ?? "").trim()) || null;
  if (!file || file.size === 0) return { error: "Elegí una imagen." };
  if (!productId) return { error: "Producto inválido." };

  const sb = await createClient();
  const { data: orgId } = await sb.rpc("current_org_id");
  if (!orgId) return { error: "Sin organización" };

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${orgId}/${productId}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: file.type || "image/jpeg" });
  if (upErr) return { error: upErr.message };

  const { error } = await sb.from("product_images").insert({ organization_id: orgId, product_id: productId, path, color });
  if (error) return { error: error.message };

  revalidatePath(`/productos/${productId}`);
  return { ok: true };
}

export async function eliminarFoto(imageId: string, path: string, productId: string): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const admin = createAdminClient();
  await admin.storage.from(BUCKET).remove([path]);

  const sb = await createClient();
  const { error } = await sb.from("product_images").delete().eq("id", imageId);
  if (error) return { error: error.message };

  revalidatePath(`/productos/${productId}`);
  return { ok: true };
}

export async function setFotoPrimaria(imageId: string, productId: string): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const sb = await createClient();
  await sb.from("product_images").update({ is_primary: false }).eq("product_id", productId);
  const { error } = await sb.from("product_images").update({ is_primary: true }).eq("id", imageId);
  if (error) return { error: error.message };

  revalidatePath(`/productos/${productId}`);
  return { ok: true };
}

export async function asignarColorFoto(imageId: string, productId: string, color: string | null): Promise<ActionState> {
  const denied = await requireCan("productos", true);
  if (denied) return denied;

  const sb = await createClient();
  const { error } = await sb.from("product_images").update({ color: color || null }).eq("id", imageId);
  if (error) return { error: error.message };

  revalidatePath(`/productos/${productId}`);
  return { ok: true };
}
