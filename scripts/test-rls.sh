#!/usr/bin/env bash
#
# Run the live RLS / cross-tenant isolation integration suite against a LOCAL
# Supabase (never production). This:
#   1. Ensures the local Supabase stack is running (boots it if not).
#   2. Applies supabase/schema.sql (idempotent — safe to re-run).
#   3. Runs the *.integration.test.ts suite, which wraps every test in a
#      transaction it ROLLs BACK, so the database is left untouched.
#
# The local Postgres URL is deterministic for `supabase start` (db.port=54322).
# Override with SUPABASE_TEST_DB_URL to point at a different local instance.
set -euo pipefail

DB_URL="${SUPABASE_TEST_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

echo "==> Checking local Supabase Postgres at ${DB_URL%%@*}@..."
if ! psql "$DB_URL" -Atc "select 1" >/dev/null 2>&1; then
  echo "==> Not reachable; starting local Supabase (this can take a while on first run)..."
  # The RLS suite only needs the database + the `auth` schema/roles (auth/gotrue
  # is not excludable, so it always runs and provisions auth.users). Skip every
  # other service — several (vector, storage) fail to start under the Colima
  # Docker runtime, and none are needed for SQL-level RLS tests.
  # --ignore-health-check keeps a flaky optional service from aborting the start.
  supabase start \
    -x edge-runtime,functions,imgproxy,inbucket,kong,meta,realtime,rest,storage,studio,vector,analytics \
    --ignore-health-check
fi

echo "==> Applying schema.sql (idempotent)..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/schema.sql >/dev/null

echo "==> Running RLS integration suite..."
SUPABASE_TEST_DB_URL="$DB_URL" npx vitest run --config vitest.integration.config.ts
