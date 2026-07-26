/**
 * Offline upload queue for clinical file attachments (Stage 4).
 *
 * Before this, attaching a results file while offline failed the whole result
 * entry. Now the file is captured into IndexedDB (Blobs store fine there), the
 * clinical record saves immediately with its final object path, and the actual
 * upload happens when the connection returns — driven by the SyncEngine, right
 * after the outbox drains.
 */

import {
  getAllRows,
  writeRows,
  PENDING_UPLOADS_STORE,
} from "@/services/localDb";
import {
  buildTenantObjectPath,
  uploadClinicalFile,
  type ClinicalBucket,
  type UploadBody,
} from "@/lib/supabase/storage";
import { notify } from "@/lib/notify";

interface PendingUpload {
  id: string;
  bucket: ClinicalBucket;
  /** Final object path — already recorded on the clinical row. */
  path: string;
  contentType: string;
  body: Blob;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `upl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface QueueOrUploadInput {
  bucket: ClinicalBucket;
  hospitalId: string;
  segments: string[];
  filename: string;
  body: UploadBody;
  contentType?: string;
}

/**
 * Upload now when possible; otherwise (offline, or the upload fails) queue the
 * file and return the path it WILL live at. Either way the caller can persist
 * the returned path on the clinical row immediately.
 */
export async function uploadOrQueueClinicalFile(
  input: QueueOrUploadInput,
): Promise<{ path: string; queued: boolean }> {
  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const { path } = await uploadClinicalFile(input);
      return { path, queued: false };
    } catch {
      /* fall through to queue — e.g. flaky connection mid-request */
    }
  }
  const path = buildTenantObjectPath(
    input.hospitalId,
    input.segments,
    input.filename,
  );
  const blob =
    input.body instanceof Blob
      ? input.body
      : new Blob([input.body as ArrayBuffer], {
          type: input.contentType || "application/octet-stream",
        });
  const pending: PendingUpload = {
    id: generateId(),
    bucket: input.bucket,
    path,
    contentType: input.contentType || "application/octet-stream",
    body: blob,
  };
  await writeRows([{ table: PENDING_UPLOADS_STORE, put: [pending] }]);
  return { path, queued: true };
}

/** How many files are still waiting to upload. */
export async function pendingUploadCount(): Promise<number> {
  const rows = await getAllRows(PENDING_UPLOADS_STORE);
  return rows.length;
}

/**
 * Upload every queued file (called by the SyncEngine when online). Files that
 * fail stay queued for the next pass; a success removes the queue entry.
 */
export async function drainPendingUploads(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const rows = (await getAllRows(PENDING_UPLOADS_STORE)) as PendingUpload[];
  for (const pending of rows) {
    try {
      const { getSupabaseClient } = await import("@/lib/supabase/client");
      const client = getSupabaseClient();
      const { error } = await client.storage
        .from(pending.bucket)
        .upload(pending.path, pending.body, {
          contentType: pending.contentType,
          upsert: true, // the path was pre-assigned; retrying must not collide
        });
      if (error) throw new Error(error.message);
      await writeRows([
        { table: PENDING_UPLOADS_STORE, remove: [pending.id] },
      ]);
    } catch {
      notify(
        {
          kind: "warning",
          titleKey: "notify.uploadRetryTitle",
          bodyKey: "notify.uploadRetryBody",
        },
        { dedupeKey: "upload-retry", dedupeMs: 120_000 },
      );
    }
  }
}
