/**
 * LIVE clinical-file storage + cross-tenant isolation (Block B / #5).
 *
 * Proves the real Supabase Storage layer behaves the way the feature relies on:
 *  - a staff member can upload a file under THEIR hospital's prefix and read it
 *    back through a signed URL, and
 *  - the storage.objects RLS policies (supabase/schema.sql) stop Hospital B from
 *    reading OR writing under Hospital A's prefix — the file-level equivalent of
 *    the table RLS verified in services/rls.integration.test.ts.
 *
 * It exercises the real access layer (lib/supabase/storage.ts) end-to-end over
 * HTTP against a LOCAL Supabase, using two tenants stood up via the real
 * `provisionHospital` action and two per-user authenticated clients.
 *
 * HOW IT STAYS SAFE
 *  - Needs the FULL local stack (kong + GoTrue + PostgREST + Storage). Run via
 *    `npm run test:storage`.
 *  - Hard-pinned to localhost; a guard refuses any non-local host.
 *  - Uploads commit (storage has no transaction to roll back), so every object,
 *    hospital, and auth user created is tracked and deleted in afterAll.
 *
 * Excluded from the default `npm test` (it's a `*.integration.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// --- Pin env at the LOCAL stack before provisionHospital builds its client. ---
const LOCAL_API_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= LOCAL_API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= LOCAL_SERVICE_ROLE_KEY;
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || LOCAL_ANON_KEY;

const apiHost = new URL(API_URL).hostname;
if (apiHost !== "127.0.0.1" && apiHost !== "localhost") {
  throw new Error(
    `Refusing to run storage integration tests against non-local host "${apiHost}".`,
  );
}

import { provisionHospital } from "@/app/actions/auth";
import { synthEmail, normalizeUsername } from "@/lib/supabase/identity";
import {
  uploadClinicalFile,
  createSignedDownloadUrl,
  LAB_RESULTS_BUCKET,
} from "@/lib/supabase/storage";

const DB_URL =
  process.env.SUPABASE_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let db: Client;

interface Tenant {
  hospitalId: string;
  userId: string;
  client: SupabaseClient;
}

const createdHospitalIds = new Set<string>();
const createdUserIds = new Set<string>();
const createdObjectPaths = new Set<string>();

function uniqueUsername(tag: string): string {
  return normalizeUsername(
    `e2e_store_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
}

/** Provision a tenant and return a signed-in (authenticated) client for it. */
async function makeTenant(tag: string): Promise<Tenant> {
  const username = uniqueUsername(tag);
  const password = "supersecret";
  const result = await provisionHospital({
    name: `Storage ${tag} Hospital`,
    admin_full_name: `Storage ${tag} Admin`,
    admin_username: username,
    admin_password: password,
  });
  if (!result.ok) throw new Error(`provisionHospital(${tag}) failed: ${result.error}`);
  createdHospitalIds.add(result.hospitalId);
  createdUserIds.add(result.userId);

  const client = createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: synthEmail(username),
    password,
  });
  if (error) throw new Error(`sign-in(${tag}) failed: ${error.message}`);
  return { hospitalId: result.hospitalId, userId: result.userId, client };
}

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  db = new Client({ connectionString: DB_URL });
  try {
    await db.connect();
    await db.query("select 1 from public.hospitals limit 0");
    const res = await fetch(`${API_URL}/storage/v1/version`);
    if (!res.ok) throw new Error(`storage version ${res.status}`);
  } catch (err) {
    throw new Error(
      `Cannot reach a local Supabase API + Storage + DB with the CareFlow schema.\n` +
        `Run \`npm run test:storage\` (it boots the full stack) instead of vitest directly.\n` +
        `Underlying error: ${(err as Error).message}`,
    );
  }
  A = await makeTenant("a");
  B = await makeTenant("b");
}, 60_000);

afterAll(async () => {
  // storage.objects has a trigger blocking direct SQL deletes — remove files via
  // the Storage API (service role bypasses RLS). Hospitals/users are plain rows.
  if (createdObjectPaths.size > 0) {
    const admin = createClient(API_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await admin.storage
      .from(LAB_RESULTS_BUCKET)
      .remove([...createdObjectPaths])
      .catch(() => {});
  }
  for (const id of createdHospitalIds) {
    await db.query("delete from public.hospitals where id = $1", [id]); // cascades staff
  }
  for (const id of createdUserIds) {
    await db.query("delete from auth.users where id = $1", [id]);
  }
  await db?.end();
});

describe("clinical file storage (real Supabase Storage + RLS)", () => {
  const fileBytes = new TextEncoder().encode("PDF-ish bytes for an X-ray report");

  it("lets a staff member upload under their hospital prefix and read it back via a signed URL", async () => {
    const { path } = await uploadClinicalFile(
      {
        bucket: LAB_RESULTS_BUCKET,
        hospitalId: A.hospitalId,
        segments: ["orders", "ord_test"],
        filename: "chest-xray-pa.pdf",
        body: fileBytes,
        contentType: "application/pdf",
      },
      A.client,
    );

    createdObjectPaths.add(path);
    // Path is tenant-prefixed (the RLS boundary) and ends in a safe name.
    expect(path.startsWith(`${A.hospitalId}/orders/ord_test/`)).toBe(true);
    expect(path).toMatch(/chest-xray-pa\.pdf$/);

    // The object row exists in the A prefix.
    const row = await db.query(
      "select name from storage.objects where bucket_id = $1 and name = $2",
      [LAB_RESULTS_BUCKET, path],
    );
    expect(row.rowCount).toBe(1);

    // A signed URL fetches the exact bytes back.
    const url = await createSignedDownloadUrl(LAB_RESULTS_BUCKET, path, 60, A.client);
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toBe("PDF-ish bytes for an X-ray report");
  });

  it("stops Hospital B from reading Hospital A's file", async () => {
    const { path } = await uploadClinicalFile(
      {
        bucket: LAB_RESULTS_BUCKET,
        hospitalId: A.hospitalId,
        segments: ["orders", "ord_secret"],
        filename: "private.pdf",
        body: fileBytes,
        contentType: "application/pdf",
      },
      A.client,
    );
    createdObjectPaths.add(path);

    // B cannot mint a signed URL for A's object — RLS hides it.
    await expect(
      createSignedDownloadUrl(LAB_RESULTS_BUCKET, path, 60, B.client),
    ).rejects.toThrow();

    // B listing A's folder sees nothing.
    const { data: listed } = await B.client.storage
      .from(LAB_RESULTS_BUCKET)
      .list(`${A.hospitalId}/orders/ord_secret`);
    expect(listed ?? []).toHaveLength(0);
  });

  it("stops Hospital B from writing under Hospital A's prefix", async () => {
    await expect(
      uploadClinicalFile(
        {
          bucket: LAB_RESULTS_BUCKET,
          hospitalId: A.hospitalId, // B impersonating A's prefix
          segments: ["orders", "ord_intrusion"],
          filename: "evil.pdf",
          body: fileBytes,
          contentType: "application/pdf",
        },
        B.client,
      ),
    ).rejects.toThrow();

    // Nothing landed under that path.
    const row = await db.query(
      "select name from storage.objects where bucket_id = $1 and name like $2",
      [LAB_RESULTS_BUCKET, `${A.hospitalId}/orders/ord_intrusion/%`],
    );
    expect(row.rowCount).toBe(0);
  });
});
