import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Live integration tests (real Postgres + RLS) are opt-in via `npm run
    // test:rls` and its own config. Keep the default unit run hermetic — no
    // network, no Docker — so `npm test` / CI never depends on a database.
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
