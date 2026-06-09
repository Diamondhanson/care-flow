#!/usr/bin/env bash
#
# Run the live hospital-onboarding integration test against a LOCAL Supabase
# (never production). Unlike the RLS suite (which only needs Postgres + the
# `auth` roles), `provisionHospital` drives the supabase-js admin client over
# HTTP, so this needs the FULL local API surface up: the kong gateway, GoTrue
# (/auth/v1) and PostgREST (/rest/v1). This script:
#   1. Ensures the local stack is running with the API gateway (boots it if not).
#   2. Applies supabase/schema.sql (idempotent) and reloads PostgREST's cache.
#   3. Exports the local API URL + service-role key and runs the test, which
#      creates real rows and then deletes every one it created (afterEach).
#
# The Colima Docker runtime on this machine can't bind-mount the Docker socket,
# so the analytics/vector services are skipped (vector is excluded here;
# analytics is disabled in supabase/config.toml). imgproxy/edge/realtime/studio/
# pooler aren't needed for onboarding.
set -euo pipefail

DB_URL="${SUPABASE_TEST_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
API_URL="${NEXT_PUBLIC_SUPABASE_URL:-http://127.0.0.1:54321}"

echo "==> Checking local Supabase API gateway at ${API_URL}..."
if ! curl -sf -o /dev/null "${API_URL}/auth/v1/health"; then
  echo "==> API not reachable; starting the full local stack (this can take a while)..."
  # Bring up the API gateway (kong) + GoTrue + PostgREST. Skip only the services
  # that are unnecessary here or incompatible with the Colima Docker runtime.
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
echo "==> Resolving local service-role key..."
eval "$(supabase status -o env 2>/dev/null | grep -E '^(SERVICE_ROLE_KEY|API_URL)=' || true)"
export NEXT_PUBLIC_SUPABASE_URL="${API_URL:-$API_URL}"
export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"

echo "==> Running onboarding integration test..."
SUPABASE_TEST_DB_URL="$DB_URL" \
  npx vitest run --config vitest.integration.config.ts \
  services/onboarding.integration.test.ts
