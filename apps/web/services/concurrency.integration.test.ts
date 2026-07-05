/**
 * LIVE optimistic-concurrency / version-guard test (Block B / #6).
 *
 * Proves the real Supabase write path behaves the way the sync layer relies on:
 *  - the `bump_version` BEFORE UPDATE trigger (supabase/schema.sql) increments a
 *    row's `version` on every update, and
 *  - the guarded conditional update in `pushChangeToServer`
 *    (services/syncQueue.ts) — `.update(...).eq("id", id).eq("version", base)` —
 *    LANDS when the base version is current (returning the server's new version)
 *    and is reported as a CONFLICT (zero rows) when the base is stale.
 *
 * This is the server-side half of the optimistic-concurrency model; the
 * client-side propagation/refetch reducers are unit-tested in syncQueue.test.ts.
 *
 * HOW IT STAYS SAFE
 *  - Needs the FULL local stack (kong + GoTrue + PostgREST). Run via
 *    `npm run test:concurrency`.
 *  - Hard-pinned to localhost; a guard refuses any non-local host.
 *  - Every hospital + auth user created is tracked and deleted in afterAll
 *    (deleting the hospital cascades its departments).
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
    `Refusing to run concurrency integration tests against non-local host "${apiHost}".`,
  );
}

import { provisionHospital } from "@/app/actions/auth";
import { synthEmail, normalizeUsername } from "@/lib/supabase/identity";
import { pushChangeToServer, type OutboxChange } from "@/services/syncQueue";

const DB_URL =
  process.env.SUPABASE_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let db: Client;

const createdHospitalIds = new Set<string>();
const createdUserIds = new Set<string>();

function uniqueUsername(tag: string): string {
  return normalizeUsername(
    `e2e_conc_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
}

let hospitalId: string;
let client: SupabaseClient;

beforeAll(async () => {
  db = new Client({ connectionString: DB_URL });
  try {
    await db.connect();
    await db.query("select 1 from public.departments limit 0");
    const res = await fetch(`${API_URL}/rest/v1/`, {
      headers: { apikey: ANON_KEY },
    });
    if (!res.ok && res.status !== 404) throw new Error(`rest status ${res.status}`);
  } catch (err) {
    throw new Error(
      `Cannot reach a local Supabase API + DB with the CareFlow schema.\n` +
        `Run \`npm run test:concurrency\` (it boots the full stack) instead of vitest directly.\n` +
        `Underlying error: ${(err as Error).message}`,
    );
  }

  const username = uniqueUsername("admin");
  const password = "supersecret";
  const result = await provisionHospital({
    name: "Concurrency Hospital",
    admin_full_name: "Concurrency Admin",
    admin_username: username,
    admin_password: password,
  });
  if (!result.ok) throw new Error(`provisionHospital failed: ${result.error}`);
  createdHospitalIds.add(result.hospitalId);
  createdUserIds.add(result.userId);
  hospitalId = result.hospitalId;

  client = createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: synthEmail(username),
    password,
  });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
}, 60_000);

afterAll(async () => {
  for (const id of createdHospitalIds) {
    await db.query("delete from public.hospitals where id = $1", [id]); // cascades departments
  }
  for (const id of createdUserIds) {
    await db.query("delete from auth.users where id = $1", [id]);
  }
  await db?.end();
});

/** Build an outbox entry as the diff layer would (fields are filled here). */
function entry(over: Partial<OutboxChange> & Pick<OutboxChange, "op" | "row_id" | "payload">): OutboxChange {
  return {
    id: `chg_${Math.random().toString(36).slice(2)}`,
    table: "departments",
    enqueued_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    ...over,
  };
}

describe("optimistic concurrency (real Supabase version guard)", () => {
  it("accepts a fresh-base update and the server bumps the version", async () => {
    const id = crypto.randomUUID();

    // Insert via the real push path — a versioned upsert returns version 1.
    const inserted = await pushChangeToServer(
      entry({
        op: "insert",
        row_id: id,
        payload: { id, hospital_id: hospitalId, name: "Cardiology" },
      }),
      client,
    );
    expect(inserted).toEqual({ status: "ok", version: 1 });

    // A guarded update whose base matches the live version (1) lands, and the
    // bump_version trigger advances the row to 2.
    const updated = await pushChangeToServer(
      entry({
        op: "update",
        row_id: id,
        payload: { id, hospital_id: hospitalId, name: "Cardiology Unit", version: 1 },
      }),
      client,
    );
    expect(updated).toEqual({ status: "ok", version: 2 });

    const row = await db.query(
      "select name, version from public.departments where id = $1",
      [id],
    );
    expect(row.rows[0]).toMatchObject({ name: "Cardiology Unit", version: 2 });
  });

  it("reports a conflict for a stale-base update and leaves the row untouched", async () => {
    const id = crypto.randomUUID();

    await pushChangeToServer(
      entry({
        op: "insert",
        row_id: id,
        payload: { id, hospital_id: hospitalId, name: "Neurology" },
      }),
      client,
    );
    // Advance the row to version 2 with a correct base.
    await pushChangeToServer(
      entry({
        op: "update",
        row_id: id,
        payload: { id, hospital_id: hospitalId, name: "Neurology v2", version: 1 },
      }),
      client,
    );

    // A second device still holds base version 1 — its write must be rejected as
    // a conflict (zero rows matched), NOT silently clobber "Neurology v2".
    const stale = await pushChangeToServer(
      entry({
        op: "update",
        row_id: id,
        payload: { id, hospital_id: hospitalId, name: "Neurology STALE", version: 1 },
      }),
      client,
    );
    expect(stale).toEqual({ status: "conflict" });

    const row = await db.query(
      "select name, version from public.departments where id = $1",
      [id],
    );
    expect(row.rows[0]).toMatchObject({ name: "Neurology v2", version: 2 });
  });
});
