/**
 * Supabase Storage access layer (Block B / #5) — clinical file attachments.
 *
 * CareFlow keeps scanned/PDF lab + imaging results and patient documents in two
 * PRIVATE buckets (`lab-results`, `patient-documents`, created in
 * supabase/schema.sql). Multi-tenant isolation is enforced exactly like the
 * table RLS: every object path MUST start with the owning hospital's id, and the
 * storage.objects policies require `(storage.foldername(name))[1]` to equal the
 * signed-in staff member's `current_hospital_id()`. So a file can never leak
 * across tenants — Hospital A literally cannot read or write under Hospital B's
 * prefix.
 *
 * This module centralizes that path convention so callers can't accidentally
 * break it, and wraps upload + signed-download. The functions default to the
 * authenticated browser client (RLS-enforced) but accept an explicit client so
 * they're testable against per-user sessions.
 */

import { getSupabaseClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Private bucket for scanned/PDF lab + imaging results. */
export const LAB_RESULTS_BUCKET = "lab-results";
/** Private bucket for scanned booklets, consent forms, IDs. */
export const PATIENT_DOCUMENTS_BUCKET = "patient-documents";

export type ClinicalBucket =
  | typeof LAB_RESULTS_BUCKET
  | typeof PATIENT_DOCUMENTS_BUCKET;

/** Body types supabase-js accepts for an upload (browser File + node Buffer). */
export type UploadBody = File | Blob | ArrayBuffer | Uint8Array;

/**
 * Make a filename safe for an object key: keep the extension, slugify the stem,
 * and prefix a short timestamp+random token so re-uploading the same name never
 * collides or silently overwrites.
 */
export function safeObjectName(filename: string): string {
  const trimmed = (filename || "file").trim();
  const dot = trimmed.lastIndexOf(".");
  const hasExt = dot > 0 && dot < trimmed.length - 1;
  const stem = (hasExt ? trimmed.slice(0, dot) : trimmed)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  const ext = hasExt
    ? trimmed
        .slice(dot + 1)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 12)
    : "";
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const base = stem || "file";
  return ext ? `${token}-${base}.${ext}` : `${token}-${base}`;
}

/**
 * Build a tenant-scoped object path. The hospital id is ALWAYS the first folder
 * (the RLS boundary); `segments` group files (e.g. ["orders", orderId]); the
 * final part is the sanitized, collision-resistant filename.
 */
export function buildTenantObjectPath(
  hospitalId: string,
  segments: string[],
  filename: string,
): string {
  if (!hospitalId) throw new Error("buildTenantObjectPath: hospitalId required");
  const clean = segments
    .map((s) => s.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean);
  return [hospitalId, ...clean, safeObjectName(filename)].join("/");
}

export interface UploadClinicalFileInput {
  bucket: ClinicalBucket;
  /** The owning hospital's id — becomes the required first path segment. */
  hospitalId: string;
  /** Logical grouping folders, e.g. ["orders", orderId]. */
  segments: string[];
  /** Original filename (used to derive a safe object name). */
  filename: string;
  body: UploadBody;
  /** MIME type; defaults to application/octet-stream. */
  contentType?: string;
}

/**
 * Upload a clinical file under the tenant prefix and return the object path to
 * persist (e.g. in `results.attachment_path`). RLS rejects the upload if the
 * caller's hospital doesn't match the path prefix.
 */
export async function uploadClinicalFile(
  input: UploadClinicalFileInput,
  client: SupabaseClient = getSupabaseClient(),
): Promise<{ path: string }> {
  const path = buildTenantObjectPath(
    input.hospitalId,
    input.segments,
    input.filename,
  );
  const { data, error } = await client.storage
    .from(input.bucket)
    .upload(path, input.body, {
      contentType: input.contentType || "application/octet-stream",
      upsert: false,
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { path: data.path };
}

/**
 * Mint a short-lived signed URL to view/download a private object. The buckets
 * are private, so this is the only way to read a file; RLS still applies, so a
 * staff member can only sign URLs for their own hospital's objects.
 */
export async function createSignedDownloadUrl(
  bucket: ClinicalBucket,
  path: string,
  expiresInSeconds = 300,
  client: SupabaseClient = getSupabaseClient(),
): Promise<string> {
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not create download link: ${error?.message ?? "denied"}`);
  }
  return data.signedUrl;
}
