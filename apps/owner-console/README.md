# @careflow/owner-console

The **platform owner** console (Phase 19) — a separate, highest-privilege app
that reads *across* tenants to monitor and manage hospital accounts. It is never
reachable from the hospital app, runs on **telemetry, not PHI**, and reaches
cross-tenant data only through a **service-role server path** behind a
`requirePlatformAdmin()` guard, so tenant RLS is never weakened.

Dev runs on **http://localhost:3001** (`pnpm dev:owner` from the repo root).

## Setup

### 1. Env (`apps/owner-console/.env.local`, gitignored)

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # server-only, never NEXT_PUBLIC
PLATFORM_ADMIN_EMAILS=you@example.com           # comma-separated allowlist
```

Point these at the **same** hosted Supabase project the hospital app uses — the
console reads every tenant via the service role.

### 2. Apply the schema

The owner tables (`platform_admins`, `usage_events`, `hospitals.feature_flags`,
…) live in `packages/db/schema.sql` (section 12). Apply it to the hosted DB so
the dashboard's activity columns populate and `platform_admins` exists.

### 3. Google OAuth for :3001

In the Supabase dashboard → Authentication → URL Configuration, add
`http://localhost:3001/auth/callback` (and your prod `admin.` domain) to the
redirect allow-list. Google is already enabled for the project.

## Access model

- Sign in with Google. Authorization is gated by the **`PLATFORM_ADMIN_EMAILS`
  allowlist** (bootstrap-friendly — you know your email, not your future auth
  uuid). On first authorized sign-in the user is recorded in `platform_admins`.
- A signed-in non-allowlisted account sees "not authorized" and can sign out.

## What's here (Phase 19.2 MVP)

- Google sign-in + `platform_admins`-gated dashboard.
- Tenants table: status, tier, signup date, 30-day event count, last-active.
- Suspend / reactivate a hospital (`subscription_status`).

Next: adoption/funnel/sync-health depth (19.3), feature flags + billing ops + the
suspend→restrict enforcement loop (19.4).
