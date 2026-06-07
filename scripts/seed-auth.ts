/**
 * One-off: mint Supabase Auth logins for the 14 seeded demo-hospital staff
 * (Phase 18a). Each gets:
 *   - a synthetic-email auth user (username + shared demo password),
 *   - user_metadata bridging to the mock data layer (mock_staff_id / mock_hospital_id),
 *   - their seeded `staff` row linked via user_id + username.
 *
 * Idempotent: re-running re-links existing users instead of erroring.
 *
 * Run: set -a; source .env.local; set +a; npx tsx scripts/seed-auth.ts
 */

import { createClient } from "@supabase/supabase-js";
import { normalizeUsername, synthEmail } from "../lib/supabase/identity";

// --- Browser polyfill so mockStorage seeds in node (call-time window check) ----
class MemoryStorage {
  private s = new Map<string, string>();
  get length() {
    return this.s.size;
  }
  getItem(k: string) {
    return this.s.has(k) ? this.s.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.s.set(k, String(v));
  }
  removeItem(k: string) {
    this.s.delete(k);
  }
  clear() {
    this.s.clear();
  }
  key(i: number) {
    return Array.from(this.s.keys())[i] ?? null;
  }
}
const mem = new MemoryStorage();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = { localStorage: mem };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = mem;

import { resetDatabase } from "../services/mockStorage";

const DEMO_PASSWORD = "CareFlow2026";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRole) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. " +
      "Run with: set -a; source .env.local; set +a; npx tsx scripts/seed-auth.ts",
  );
}
const admin = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function usernameFor(staff: any): string {
  if (staff.role === "admin") return "admin";
  const parts = String(staff.full_name).trim().split(/\s+/);
  return normalizeUsername(parts[parts.length - 1]);
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  // 14 users — a single page is plenty.
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) throw error;
  const found = data.users.find(
    (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
  );
  return found?.id ?? null;
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = resetDatabase() as unknown as Record<string, any[]>;
  const staff = db.staff ?? [];

  // Resolve the seeded demo hospital's real UUID.
  const { data: hospitals, error: hErr } = await admin
    .from("hospitals")
    .select("id, name");
  if (hErr) throw hErr;
  if (!hospitals || hospitals.length === 0) {
    throw new Error("No hospitals in DB — run the data seed (seed.sql) first.");
  }
  const demo =
    hospitals.find((h) => h.name === "Douala General Hospital") ?? hospitals[0];
  const demoUuid = demo.id as string;

  const rows: { username: string; role: string; name: string }[] = [];

  for (const s of staff) {
    const username = usernameFor(s);
    const email = synthEmail(username);
    const metadata = {
      username,
      full_name: s.full_name,
      role: s.role,
      hospital_id: demoUuid,
      mock_hospital_id: "hosp_demo",
      mock_staff_id: s.id,
    };

    let userId: string | null = null;
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (cErr) {
      const dup = /already.*registered|exists/i.test(cErr.message);
      if (!dup) throw cErr;
      userId = await findUserIdByEmail(email);
      if (!userId) throw new Error(`Could not resolve existing user ${email}`);
      // Refresh metadata + password on re-run.
      await admin.auth.admin.updateUserById(userId, {
        password: DEMO_PASSWORD,
        user_metadata: metadata,
      });
    } else {
      userId = created.user.id;
    }

    // Link the seeded staff row (match by full_name within the demo hospital).
    const { error: uErr } = await admin
      .from("staff")
      .update({ user_id: userId, username })
      .eq("hospital_id", demoUuid)
      .eq("full_name", s.full_name);
    if (uErr) throw uErr;

    rows.push({ username, role: s.role, name: s.full_name });
  }

  rows.sort((a, b) => a.role.localeCompare(b.role) || a.username.localeCompare(b.username));
  process.stderr.write(`\nProvisioned ${rows.length} demo logins (password: ${DEMO_PASSWORD})\n`);
  process.stderr.write("username".padEnd(14) + "role".padEnd(14) + "name\n");
  for (const r of rows) {
    process.stderr.write(r.username.padEnd(14) + r.role.padEnd(14) + r.name + "\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
