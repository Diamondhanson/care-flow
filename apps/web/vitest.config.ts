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
      // Resolve the shared workspace package's TS source directly (vitest won't
      // transpile a node_modules `.ts` exports map on its own).
      "@careflow/shared/validation/email": resolve(
        __dirname,
        "../../packages/shared/validation/email.ts",
      ),
      "@careflow/shared/validation/primitives": resolve(
        __dirname,
        "../../packages/shared/validation/primitives.ts",
      ),
      "@careflow/shared/validation/schemas": resolve(
        __dirname,
        "../../packages/shared/validation/schemas.ts",
      ),
      "@careflow/shared": resolve(
        __dirname,
        "../../packages/shared/types/healthcare.ts",
      ),
    },
  },
});
