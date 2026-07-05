"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const VALID_STATUSES = ["trial", "active", "suspended"] as const;

/**
 * Set a hospital's subscription status (suspend / reactivate). Service-role
 * write, behind the platform-admin guard. Invoked from a dashboard `<form>`.
 */
export async function setHospitalStatusAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();

  const hospitalId = String(formData.get("hospitalId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!hospitalId) return;
  if (!(VALID_STATUSES as readonly string[]).includes(status)) return;

  await getSupabaseAdmin()
    .from("hospitals")
    .update({ subscription_status: status, updated_at: new Date().toISOString() })
    .eq("id", hospitalId);

  revalidatePath("/");
}
