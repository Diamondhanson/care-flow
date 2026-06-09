import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Config for the LIVE integration suite (`npm run test:rls`) — the only tests
 * that talk to a real Postgres with the CareFlow schema + RLS applied. They run
 * against a LOCAL Supabase (see scripts/test-rls.sh), never production, and each
 * test wraps its work in a transaction it always ROLLs BACK, so the database is
 * left untouched.
 *
 * Kept separate from vitest.config.ts so the default `npm test` stays hermetic
 * (no Docker, no network). These files are named `*.integration.test.ts`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    // Booting/seeding the DB and the round-trips take longer than unit tests.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
