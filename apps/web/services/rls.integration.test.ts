/**
 * LIVE cross-tenant isolation + audit + RLS verification (Block A).
 *
 * Unlike services/tenancy.test.ts (which proves the *mock* layer scopes reads),
 * this suite proves the real PostgreSQL Row-Level-Security policies in
 * supabase/schema.sql actually stop Hospital A from reading or writing Hospital
 * B's data — the security boundary the whole multi-tenant app relies on.
 *
 * HOW IT STAYS SAFE
 *  - Runs against a LOCAL Supabase only (see scripts/test-rls.sh). Never prod.
 *  - Every test does its work inside a transaction it ALWAYS ROLLs BACK, so the
 *    database is left exactly as it was — no test data ever persists.
 *  - It impersonates a logged-in user the way Supabase does at runtime: assume
 *    the non-privileged `authenticated` role and set the `request.jwt.claims`
 *    GUC so auth.uid() resolves. As `authenticated` (not the superuser the
 *    connection opens as) RLS is enforced exactly as it is for a real client.
 *
 * Excluded from the default `npm test` run; invoke via `npm run test:rls`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const DB_URL =
  process.env.SUPABASE_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: DB_URL });
  try {
    await client.connect();
    // Fail loudly (not skip) — this suite is opt-in via `npm run test:rls`,
    // which guarantees a local Supabase with the schema applied is up.
    await client.query("select 1 from public.hospitals limit 0");
  } catch (err) {
    throw new Error(
      `Cannot reach a local Supabase with the CareFlow schema at ${DB_URL}.\n` +
        `Run \`npm run test:rls\` (it boots Supabase + applies schema.sql) instead of vitest directly.\n` +
        `Underlying error: ${(err as Error).message}`,
    );
  }
});

afterAll(async () => {
  if (client) await client.end();
});

// ---------------------------------------------------------------------------
// Transaction + impersonation helpers
// ---------------------------------------------------------------------------

/** Run `fn` inside a transaction that is ALWAYS rolled back. */
async function inRolledBackTx(fn: () => Promise<void>): Promise<void> {
  await client.query("begin");
  try {
    await fn();
  } finally {
    // Reset any assumed role first so ROLLBACK runs as the session superuser.
    await client.query("reset role").catch(() => {});
    await client.query("rollback");
  }
}

/** Assume the `authenticated` role with the given auth user id (auth.uid()). */
async function actAs(userId: string): Promise<void> {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("set role authenticated");
}

/** Drop back to the privileged session role for setup / catalog reads. */
async function asSuperuser(): Promise<void> {
  await client.query("reset role");
}

// --- Setup writers (run as superuser; bypass RLS to stand up fixtures) ------

async function makeAuthUser(email: string): Promise<string> {
  const { rows } = await client.query(
    `insert into auth.users
       (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, is_super_admin)
     values
       ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
        'authenticated', 'authenticated', $1, '',
        now(), now(), now(), '{}'::jsonb, '{}'::jsonb, false)
     returning id`,
    [email],
  );
  return rows[0].id as string;
}

async function makeHospital(name: string): Promise<string> {
  const { rows } = await client.query(
    "insert into public.hospitals (name, subscription_status) values ($1, 'active') returning id",
    [name],
  );
  return rows[0].id as string;
}

async function makeStaff(
  hospitalId: string,
  userId: string,
  role = "admin",
): Promise<string> {
  const { rows } = await client.query(
    `insert into public.staff (hospital_id, user_id, full_name, role, is_active)
     values ($1, $2, $3, $4, true) returning id`,
    [hospitalId, userId, `Test ${role}`, role],
  );
  return rows[0].id as string;
}

async function makePatient(hospitalId: string, name: string): Promise<string> {
  const { rows } = await client.query(
    "insert into public.patients (hospital_id, full_name) values ($1, $2) returning id",
    [hospitalId, name],
  );
  return rows[0].id as string;
}

/** Stand up two isolated tenants, each with one admin staff member. */
async function twoTenants() {
  const userA = await makeAuthUser("admin-a@careflow.local");
  const userB = await makeAuthUser("admin-b@careflow.local");
  const hospitalA = await makeHospital("RLS Tenant A");
  const hospitalB = await makeHospital("RLS Tenant B");
  await makeStaff(hospitalA, userA);
  await makeStaff(hospitalB, userB);
  return { userA, userB, hospitalA, hospitalB };
}

// ---------------------------------------------------------------------------
// Cross-tenant isolation (the core proof)
// ---------------------------------------------------------------------------

describe("cross-tenant isolation (real Postgres RLS)", () => {
  it("a staff member reads only their own hospital's patients", async () => {
    await inRolledBackTx(async () => {
      const { userA, userB, hospitalA, hospitalB } = await twoTenants();
      await makePatient(hospitalA, "Alice A");
      await makePatient(hospitalA, "Aaron A");
      await makePatient(hospitalB, "Bob B");

      await actAs(userA);
      const a = await client.query("select hospital_id from public.patients");
      expect(a.rows).toHaveLength(2);
      expect(a.rows.every((r) => r.hospital_id === hospitalA)).toBe(true);

      await actAs(userB);
      const b = await client.query("select hospital_id from public.patients");
      expect(b.rows).toHaveLength(1);
      expect(b.rows.every((r) => r.hospital_id === hospitalB)).toBe(true);
    });
  });

  it("cannot read another hospital's rows even when querying by its id", async () => {
    await inRolledBackTx(async () => {
      const { userA, hospitalB } = await twoTenants();
      await makePatient(hospitalB, "Bob B");

      await actAs(userA);
      const leaked = await client.query(
        "select id from public.patients where hospital_id = $1",
        [hospitalB],
      );
      expect(leaked.rows).toHaveLength(0);
    });
  });

  it("can write rows for its own hospital", async () => {
    await inRolledBackTx(async () => {
      const { userA, hospitalA } = await twoTenants();
      await actAs(userA);
      const ins = await client.query(
        "insert into public.patients (hospital_id, full_name) values ($1, $2) returning id",
        [hospitalA, "Own Tenant Patient"],
      );
      expect(ins.rows).toHaveLength(1);
    });
  });

  it("cannot insert a row stamped to another hospital (WITH CHECK)", async () => {
    await inRolledBackTx(async () => {
      const { userA, hospitalB } = await twoTenants();
      await actAs(userA);
      await expect(
        client.query(
          "insert into public.patients (hospital_id, full_name) values ($1, $2)",
          [hospitalB, "Cross-Tenant Mallory"],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("cannot update another hospital's row into view", async () => {
    await inRolledBackTx(async () => {
      const { userA, hospitalB } = await twoTenants();
      const victim = await makePatient(hospitalB, "Bob B");
      await actAs(userA);
      // The row is invisible, so the UPDATE simply matches nothing — 0 rows.
      const res = await client.query(
        "update public.patients set full_name = 'hacked' where id = $1",
        [victim],
      );
      expect(res.rowCount).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

describe("audit trail capture", () => {
  it("records an audit row stamped with the acting user and hospital", async () => {
    await inRolledBackTx(async () => {
      const { userA, hospitalA } = await twoTenants();
      await actAs(userA);
      const ins = await client.query(
        "insert into public.patients (hospital_id, full_name) values ($1, $2) returning id",
        [hospitalA, "Audited Patient"],
      );
      const patientId = ins.rows[0].id as string;

      await asSuperuser();
      const audit = await client.query(
        `select action, hospital_id, changed_by_user
           from public.audit_log
          where table_name = 'patients' and record_id = $1 and action = 'INSERT'`,
        [patientId],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].hospital_id).toBe(hospitalA);
      expect(audit.rows[0].changed_by_user).toBe(userA);
    });
  });

  it("scopes audit reads per tenant and blocks client writes to the log", async () => {
    await inRolledBackTx(async () => {
      const { userA, userB, hospitalA, hospitalB } = await twoTenants();

      await actAs(userA);
      await client.query(
        "insert into public.patients (hospital_id, full_name) values ($1, $2)",
        [hospitalA, "A Patient"],
      );
      await actAs(userB);
      await client.query(
        "insert into public.patients (hospital_id, full_name) values ($1, $2)",
        [hospitalB, "B Patient"],
      );

      // Admin A sees only Hospital A's audit rows.
      await actAs(userA);
      const visible = await client.query(
        "select distinct hospital_id from public.audit_log",
      );
      expect(visible.rows.length).toBeGreaterThan(0);
      expect(visible.rows.every((r) => r.hospital_id === hospitalA)).toBe(true);

      // No client may write the audit log directly (no INSERT policy exists).
      await expect(
        client.query(
          "insert into public.audit_log (table_name, action) values ('patients', 'INSERT')",
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Structural verification — catches a future table that forgets RLS / audit
// ---------------------------------------------------------------------------

describe("RLS structural verification", () => {
  const RLS_TABLES = [
    "hospitals",
    "departments",
    "wards",
    "beds",
    "staff",
    "patients",
    "visits",
    "consultations",
    "diagnoses",
    "orders",
    "results",
    "prescriptions",
    "medication_administrations",
    "treatment_records",
    "admissions",
    "transfers",
    "allergies",
    "care_plan_items",
    "care_plan_entries",
    "audit_log",
  ];

  const AUDITED_TABLES = [
    "patients",
    "visits",
    "consultations",
    "diagnoses",
    "orders",
    "results",
    "prescriptions",
    "medication_administrations",
    "treatment_records",
    "admissions",
    "transfers",
    "beds",
    "wards",
    "departments",
    "staff",
    "allergies",
    "care_plan_items",
    "care_plan_entries",
  ];

  it("RLS is enabled on every domain + audit table", async () => {
    await asSuperuser();
    const { rows } = await client.query(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1)`,
      [RLS_TABLES],
    );
    for (const table of RLS_TABLES) {
      const found = rows.find((r) => r.relname === table);
      expect(found, `table ${table} not found`).toBeDefined();
      expect(found.relrowsecurity, `RLS not enabled on ${table}`).toBe(true);
    }
  });

  it("every table carrying hospital_id enforces RLS (regression guard)", async () => {
    await asSuperuser();
    const { rows } = await client.query(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and exists (
            select 1 from information_schema.columns col
             where col.table_schema = 'public'
               and col.table_name = c.relname
               and col.column_name = 'hospital_id')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.relrowsecurity, `tenant table ${r.relname} has RLS disabled`).toBe(
        true,
      );
    }
  });

  it("an audit trigger is attached to every sensitive table", async () => {
    await asSuperuser();
    const { rows } = await client.query(
      `select tgrelid::regclass::text as tbl
         from pg_trigger
        where tgname like 'trg_%_audit' and not tgisinternal`,
    );
    const tables = new Set(
      rows.map((r) => String(r.tbl).replace(/^public\./, "").replace(/"/g, "")),
    );
    for (const table of AUDITED_TABLES) {
      expect(tables.has(table), `no audit trigger on ${table}`).toBe(true);
    }
  });

  it("the RLS helper functions exist", async () => {
    await asSuperuser();
    const fns = [
      "current_hospital_id",
      "current_staff_id",
      "current_staff_role",
      "is_staff",
      "audit_trigger",
    ];
    const { rows } = await client.query(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1)`,
      [fns],
    );
    const have = new Set(rows.map((r) => r.proname));
    for (const fn of fns) {
      expect(have.has(fn), `missing function ${fn}()`).toBe(true);
    }
  });

  it("every tenant-scoped table has a policy referencing current_hospital_id()", async () => {
    await asSuperuser();
    const { rows } = await client.query(
      `select tablename, qual, with_check
         from pg_policies where schemaname = 'public'`,
    );
    const scoped = RLS_TABLES.filter((t) => t !== "audit_log");
    for (const table of scoped) {
      const policies = rows.filter((r) => r.tablename === table);
      expect(policies.length, `no policies on ${table}`).toBeGreaterThan(0);
      const mentionsTenant = policies.some((p) =>
        `${p.qual ?? ""} ${p.with_check ?? ""}`.includes("current_hospital_id"),
      );
      expect(mentionsTenant, `${table} policies missing tenant scope`).toBe(true);
    }
  });
});
