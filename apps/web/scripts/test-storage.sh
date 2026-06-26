#!/usr/bin/env bash
#
# Run the live clinical-file storage + cross-tenant isolation test against a
# LOCAL Supabase (never production). Needs the FULL local API surface — the kong
# gateway, GoTrue (/auth/v1), PostgREST (/rest/v1) AND Storage (/storage/v1) —
# because the access layer drives the supabase-js storage client over HTTP. This
# script:
#   1. Ensures the full local stack is running (boots it if not).
#   2. Applies supabase/schema.sql (idempotent) — creates the buckets + RLS — and
#      reloads PostgREST's schema cache.
#   3. Exports the local API URL + keys and runs the test, which creates real
#      tenants + objects and deletes everything it created (afterAll).
#
# Colima can't bind-mount the Docker socket, so analytics/vector are skipped
# (vector excluded here; analytics disabled in supabase/config.toml).
set -euo pipefail

DB_URL="${SUPABASE_TEST_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
API_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}"

echo "==> Checking local Supabase Storage at ${API_URL}..."
if ! curl -sf -o /dev/null "${API_URL}/storage/v1/version"; then
  echo "==> Storage not reachable; starting the full local stack (this can take a while)..."
  supabase start \
    -x edge-runtime,functions,imgproxy,realtime,studio,vector,analytics,pooler \
    --ignore-health-check
fi

echo "==> Applying schema.sql (idempotent)..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/schema.sql >/dev/null

echo "==> Reloading PostgREST schema cache..."
psql "$DB_URL" -q -c "NOTIFY pgrst, 'reload schema';" >/dev/null
sleep 2

# Source the local keys from the CLI so they always match the running stack.
echo "==> Resolving local keys..."
eval "$(supabase status -o env 2>/dev/null | grep -E '^(SERVICE_ROLE_KEY|ANON_KEY|API_URL)=' || true)"
export NEXT_PUBLIC_SUPABASE_URL="${API_URL}"
export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"

echo "==> Running storage integration test..."
SUPABASE_TEST_DB_URL="$DB_URL" \
  npx vitest run --config vitest.integration.config.ts \
  services/storage.integration.test.ts
