# @careflow/db

Single source of truth for the CareFlow Postgres schema, shared by `apps/web`
and `apps/owner-console`.

- **`schema.sql`** — the full schema: tables, enums, indexes, triggers, RLS
  policies, storage buckets, the `create_hospital_and_admin` RPC, and the
  defense-in-depth CHECK constraints (section 11). Idempotent; applied with
  `psql -f`.

The `apps/web` integration scripts (`scripts/test-*.sh`) apply this file against
a **local** Supabase (`-f ../../packages/db/schema.sql`). Phase 19.1 will add the
owner-console tables (`platform_admins`, `usage_events`, `hospitals.feature_flags`,
…) here so both apps share one schema.
