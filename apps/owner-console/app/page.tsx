import type { Hospital } from "@careflow/shared";
import { isValidEmail } from "@careflow/shared/validation/email";

/**
 * Phase 19.0 scaffold. This placeholder proves the owner console consumes the
 * `@careflow/shared` workspace package at BOTH the type level (`Hospital`) and
 * runtime (`isValidEmail`) — the cross-app shared contract is wired. The real
 * cross-tenant dashboard (auth gated by `platform_admins`, service-role data
 * path) lands in Phase 19.2.
 */
export default function Page() {
  const sample: Pick<Hospital, "name" | "subscription_status"> = {
    name: "Demo Hospital",
    subscription_status: "trial",
  };
  const sharedRuntimeOk = isValidEmail("owner@careflow.app");

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px" }}>
      <p
        style={{
          fontSize: 12,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "#94a3b8",
          margin: 0,
        }}
      >
        CareFlow · Platform owner
      </p>
      <h1 style={{ fontSize: 28, margin: "8px 0 12px" }}>Owner Console</h1>
      <p style={{ color: "#cbd5e1", lineHeight: 1.6 }}>
        Phase&nbsp;19.0 monorepo scaffold. The cross-app shared contract
        (<code>@careflow/shared</code>) is wired — sample tenant{" "}
        <strong>{sample.name}</strong> ({sample.subscription_status}); shared
        runtime check passed: {String(sharedRuntimeOk)}.
      </p>
      <p style={{ color: "#64748b", fontSize: 13 }}>
        Next: telemetry groundwork (19.1) → tenants dashboard gated by{" "}
        <code>platform_admins</code> (19.2).
      </p>
    </main>
  );
}
