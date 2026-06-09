/**
 * LIVE hospital-onboarding verification (Block B / #4).
 *
 * Exercises `provisionHospital` (app/actions/auth.ts) end-to-end against a real
 * local Supabase — the privileged signup path that the browser can't run itself
 * (the `hospitals` table has no client INSERT policy, and minting an auth user
 * needs the service role). It proves the three linked rows are created and wired
 * together, and that a duplicate username rolls the hospital back so no orphan
 * tenant is ever left behind.
 *
 * HOW IT STAYS SAFE
 *  - Talks to the supabase-js admin client over HTTP (kong → GoTrue + PostgREST),
 *    so it needs the FULL local stack up — not just Postgres. Run via
 *    `npm run test:onboarding` (boots the stack incl. the API gateway).
 *  - Hard-pinned to a LOCAL Supabase URL, and a guard refuses to run unless the
 *    configured URL is localhost — it can never touch a remote/prod instance.
 *  - Unlike the RLS suite, `provisionHospital` performs REAL writes that commit
 *    (it is a production action, not a rolled-back probe). So every row this test
 *    creates is tracked and deleted in `afterEach` — deleting the hospital
 *    cascades its staff; the auth user is removed explicitly.
 *
 * Excluded from the default `npm test` run (it's a `*.integration.test.ts`).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// --- Pin the admin client at the LOCAL stack BEFORE it is ever constructed. ---
// getSupabaseAdmin() reads these lazily on first use and memoizes, so setting
// them here (module load, before any test calls provisionHospital) is enough.
// Defaults are the deterministic local-stack values; the runner script
// (scripts/test-onboarding.sh) may export real ones from `supabase status`.
const LOCAL_API_URL = "http://127.0.0.1:54321";
// The well-known PUBLIC local-stack service-role JWT (same demo key the CLI
// ships and the other integration tests use). Only valid against a localhost
// stack; the runner script exports the real key from `supabase status`.
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_SUPABASE_URL ||= LOCAL_API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= LOCAL_SERVICE_ROLE_KEY;

// Safety: never let this run against anything but localhost.
const apiHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (apiHost !== "127.0.0.1" && apiHost !== "localhost") {
  throw new Error(
    `Refusing to run onboarding integration tests against non-local host "${apiHost}".`,
  );
}

import { provisionHospital } from "@/app/actions/auth";
import { synthEmail, normalizeUsername } from "@/lib/supabase/identity";

const DB_URL =
  process.env.SUPABASE_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let db: Client;

// Rows created by a test, torn down after it.
const createdHospitalIds = new Set<string>();
const createdUserIds = new Set<string>();

/** A username guaranteed unique per run, so reruns never collide. */
function uniqueUsername(tag: string): string {
  return normalizeUsername(
    `e2e_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
}

beforeAll(async () => {
  db = new Client({ connectionString: DB_URL });
  try {
    await db.connect();
    await db.query("select 1 from public.hospitals limit 0");
    // The API gateway must be reachable too (provisionHospital goes over HTTP).
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`,
    );
    if (!res.ok) throw new Error(`auth health ${res.status}`);
  } catch (err) {
    throw new Error(
      `Cannot reach a local Supabase API + DB with the CareFlow schema.\n` +
        `Run \`npm run test:onboarding\` (it boots the full stack) instead of vitest directly.\n` +
        `Underlying error: ${(err as Error).message}`,
    );
  }
});

afterEach(async () => {
  // Delete hospitals (cascades staff) then auth users. Order independent given
  // staff.user_id is ON DELETE SET NULL, but we clear both regardless.
  for (const id of createdHospitalIds) {
    await db.query("delete from public.hospitals where id = $1", [id]);
  }
  for (const id of createdUserIds) {
    await db.query("delete from auth.users where id = $1", [id]);
  }
  createdHospitalIds.clear();
  createdUserIds.clear();
});

afterAll(async () => {
  if (db) await db.end();
});

describe("hospital onboarding (real Supabase)", () => {
  it("provisions the hospital, auth user, and founding-admin staff row, all linked", async () => {
    const username = uniqueUsername("ok");
    const result = await provisionHospital({
      name: "E2E General Hospital",
      region: "Test Region",
      contact_email: "info@e2e.example",
      contact_phone: "+10000000000",
      admin_full_name: "E2E Founder Admin",
      admin_username: username,
      admin_password: "supersecret",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow for TS
    createdHospitalIds.add(result.hospitalId);
    createdUserIds.add(result.userId);

    // 1. Hospital row — created as a trial tenant.
    const hosp = await db.query(
      "select id, name, region, subscription_status from public.hospitals where id = $1",
      [result.hospitalId],
    );
    expect(hosp.rowCount).toBe(1);
    expect(hosp.rows[0].name).toBe("E2E General Hospital");
    expect(hosp.rows[0].region).toBe("Test Region");
    expect(hosp.rows[0].subscription_status).toBe("trial");

    // 2. Staff row — the founding admin, linked to the hospital + auth user.
    const staff = await db.query(
      "select id, hospital_id, user_id, role, username, full_name, is_active from public.staff where id = $1",
      [result.staffId],
    );
    expect(staff.rowCount).toBe(1);
    expect(staff.rows[0].hospital_id).toBe(result.hospitalId);
    expect(staff.rows[0].user_id).toBe(result.userId);
    expect(staff.rows[0].role).toBe("admin");
    expect(staff.rows[0].username).toBe(username);
    expect(staff.rows[0].full_name).toBe("E2E Founder Admin");
    expect(staff.rows[0].is_active).toBe(true);

    // 3. Auth user — synthetic email + complete metadata bridge.
    const user = await db.query(
      "select id, email, raw_user_meta_data from auth.users where id = $1",
      [result.userId],
    );
    expect(user.rowCount).toBe(1);
    expect(user.rows[0].email).toBe(synthEmail(username));
    const meta = user.rows[0].raw_user_meta_data;
    expect(meta.username).toBe(username);
    expect(meta.role).toBe("admin");
    expect(meta.hospital_id).toBe(result.hospitalId);
    // The session bridge (services/supabaseAuth.metaToIdentity) requires BOTH.
    expect(meta.mock_hospital_id).toBe(result.hospitalId);
    expect(meta.mock_staff_id).toBe(result.staffId);
  });

  it("rejects a duplicate username and rolls back the hospital (no orphan tenant)", async () => {
    const username = uniqueUsername("dup");

    // First signup succeeds.
    const first = await provisionHospital({
      name: "Dup First Hospital",
      admin_full_name: "First Admin",
      admin_username: username,
      admin_password: "supersecret",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    createdHospitalIds.add(first.hospitalId);
    createdUserIds.add(first.userId);

    // Second signup with the SAME username, but a distinct hospital name, must
    // fail at the auth step — and the hospital it created first must be rolled
    // back, leaving no orphan tenant by that name.
    const second = await provisionHospital({
      name: "Dup Second Hospital",
      admin_full_name: "Second Admin",
      admin_username: username,
      admin_password: "supersecret",
    });
    expect(second.ok).toBe(false);
    if (second.ok) {
      // Defensive cleanup if the contract were ever violated.
      createdHospitalIds.add(second.hospitalId);
      createdUserIds.add(second.userId);
    } else {
      expect(second.error).toMatch(/already taken/i);
    }

    // No "Dup Second Hospital" row should survive the rolled-back attempt.
    const orphan = await db.query(
      "select id from public.hospitals where name = $1",
      ["Dup Second Hospital"],
    );
    expect(orphan.rowCount).toBe(0);
  });

  it("validates input before touching the database", async () => {
    const shortPw = await provisionHospital({
      name: "Bad Hospital",
      admin_full_name: "Admin",
      admin_username: uniqueUsername("val"),
      admin_password: "123",
    });
    expect(shortPw.ok).toBe(false);
    if (!shortPw.ok) expect(shortPw.error).toMatch(/6 characters/i);

    const noName = await provisionHospital({
      name: "   ",
      admin_full_name: "Admin",
      admin_username: uniqueUsername("val"),
      admin_password: "supersecret",
    });
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.error).toMatch(/hospital name/i);

    // Neither validation failure should have created any hospital.
    const leaked = await db.query(
      "select id from public.hospitals where name in ('Bad Hospital', '   ')",
    );
    expect(leaked.rowCount).toBe(0);
  });
});
