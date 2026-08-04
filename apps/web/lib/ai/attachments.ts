/**
 * Moment 2 attachments (Phase 22, spec §6): fetch result scans/PDFs from the
 * private `lab-results` storage bucket, server-side, through the caller's
 * RLS-bound client (object paths are tenant-scoped folders, so another
 * hospital's file is unreachable by construction). Only images/PDFs under
 * the size cap are inlined; anything else is skipped silently — a missing
 * attachment must never block the suggestion.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PatientContext } from "@careflow/shared/types/ai";

const BUCKET = "lab-results";
const MAX_ATTACHMENTS = 2;
const MAX_BYTES = 4 * 1024 * 1024; // keep the prompt lean — §13 performance

const OK_MIME = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

export async function fetchResultAttachments(
  supabase: SupabaseClient,
  ctx: PatientContext,
): Promise<{ mimeType: string; data: string }[]> {
  const parts: { mimeType: string; data: string }[] = [];

  for (const result of ctx.results) {
    if (parts.length >= MAX_ATTACHMENTS) break;
    const path = result.attachmentPath;
    if (!path) continue;

    try {
      const { data: blob, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !blob) continue;

      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = OK_MIME.has(blob.type) ? blob.type : (EXT_MIME[ext] ?? "");
      if (!OK_MIME.has(mimeType)) continue;
      if (blob.size > MAX_BYTES) continue;

      const buf = Buffer.from(await blob.arrayBuffer());
      parts.push({ mimeType, data: buf.toString("base64") });
    } catch {
      // Unreadable attachment — skip; the text results still go to the model.
    }
  }

  return parts;
}
