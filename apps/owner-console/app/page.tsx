import { requirePlatformAdmin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { Card, StatusBadge, c } from "@/lib/ui";
import { setHospitalStatusAction } from "./actions";
import { SignOutButton } from "./login/auth-buttons";

export const metadata = { title: "Tenants — CareFlow Owner Console" };

interface HospitalRow {
  id: string;
  name: string;
  region: string | null;
  subscription_status: string;
  subscription_tier: string | null;
  created_at: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function DashboardPage() {
  const admin = await requirePlatformAdmin();
  const supabase = getSupabaseAdmin();

  // Tenants — the hospitals table always exists. Select only columns that are
  // guaranteed present; the Phase 19.1 additions (trial_ends_at, feature_flags)
  // may not be applied to this DB yet, and a select on a missing column errors.
  const { data: hospitalData, error: hospitalError } = await supabase
    .from("hospitals")
    .select("id, name, region, subscription_status, subscription_tier, created_at")
    .order("created_at", { ascending: false });
  const hospitals = (hospitalData ?? []) as HospitalRow[];

  // Activity from usage_events over the last 30 days. Best-effort: the telemetry
  // tables may not be applied to this DB yet (the dashboard still works without).
  const activity = new Map<string, { count: number; last: string | null }>();
  try {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: events } = await supabase
      .from("usage_events")
      .select("hospital_id, created_at")
      .gte("created_at", since)
      .limit(10_000);
    for (const e of (events ?? []) as { hospital_id: string; created_at: string }[]) {
      const cur = activity.get(e.hospital_id) ?? { count: 0, last: null };
      cur.count += 1;
      if (!cur.last || e.created_at > cur.last) cur.last = e.created_at;
      activity.set(e.hospital_id, cur);
    }
  } catch {
    /* telemetry not applied yet — show tenants without activity */
  }

  const total = hospitals.length;
  const count = (s: string) =>
    hospitals.filter((h) => h.subscription_status === s).length;

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 24px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 28,
        }}
      >
        <div>
          <p
            style={{
              fontSize: 12,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: c.muted,
              margin: "0 0 6px",
            }}
          >
            CareFlow · Platform owner
          </p>
          <h1 style={{ fontSize: 26, margin: 0 }}>Tenants</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: c.faint, fontSize: 13 }}>{admin.email}</span>
          <SignOutButton />
        </div>
      </header>

      {/* KPI tiles */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <Kpi label="Hospitals" value={total} />
        <Kpi label="Active" value={count("active")} tone={c.ok} />
        <Kpi label="Trial" value={count("trial")} tone={c.warn} />
        <Kpi label="Suspended" value={count("suspended")} tone={c.danger} />
      </section>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#0b1424", color: c.muted }}>
              <Th>Hospital</Th>
              <Th>Status</Th>
              <Th>Tier</Th>
              <Th>Signed up</Th>
              <Th numeric>Events (30d)</Th>
              <Th>Last active</Th>
              <Th>Manage</Th>
            </tr>
          </thead>
          <tbody>
            {hospitalError ? (
              <tr>
                <td colSpan={7} style={{ padding: 20, color: c.danger }}>
                  Couldn&apos;t load tenants: {hospitalError.message}
                </td>
              </tr>
            ) : hospitals.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 20, color: c.faint }}>
                  No hospitals yet.
                </td>
              </tr>
            ) : (
              hospitals.map((h) => {
                const act = activity.get(h.id);
                const suspended = h.subscription_status === "suspended";
                return (
                  <tr key={h.id} style={{ borderTop: `1px solid ${c.border}` }}>
                    <Td>
                      <div style={{ color: c.text, fontWeight: 600 }}>{h.name}</div>
                      <div style={{ color: c.faint, fontSize: 12 }}>
                        {h.region ?? "—"}
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge status={h.subscription_status} />
                    </Td>
                    <Td>{h.subscription_tier ?? "—"}</Td>
                    <Td>{fmtDate(h.created_at)}</Td>
                    <Td numeric>{act?.count ?? 0}</Td>
                    <Td>{fmtDate(act?.last ?? null)}</Td>
                    <Td>
                      <form action={setHospitalStatusAction}>
                        <input type="hidden" name="hospitalId" value={h.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={suspended ? "active" : "suspended"}
                        />
                        <button
                          type="submit"
                          style={{
                            padding: "5px 12px",
                            borderRadius: 7,
                            border: `1px solid ${suspended ? c.ok : c.danger}`,
                            background: "transparent",
                            color: suspended ? c.ok : c.danger,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {suspended ? "Reactivate" : "Suspend"}
                        </button>
                      </form>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      <p style={{ color: c.faint, fontSize: 12, marginTop: 16 }}>
        Cross-tenant reads run server-side via the service role, behind a
        platform-admin guard. Telemetry tables must be applied to this database
        for activity columns to populate.
      </p>
    </main>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ color: c.muted, fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: tone ?? c.text,
        }}
      >
        {value}
      </div>
    </Card>
  );
}

function Th({
  children,
  numeric,
}: {
  children: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <th
      style={{
        textAlign: numeric ? "right" : "left",
        padding: "10px 14px",
        fontWeight: 600,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  numeric,
}: {
  children: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <td
      style={{
        padding: "10px 14px",
        textAlign: numeric ? "right" : "left",
        color: c.text,
        verticalAlign: "top",
        fontVariantNumeric: numeric ? "tabular-nums" : undefined,
      }}
    >
      {children}
    </td>
  );
}
