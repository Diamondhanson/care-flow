import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * DOM-level component test project (jsdom + Testing Library).
 *
 * Kept separate from vitest.config.ts so the default `pnpm test` node suite
 * stays hermetic and fast. Run with `pnpm test:dom`. Test files use the
 * `*.domtest.tsx` suffix so neither suite ever picks up the other's files.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["**/*.domtest.tsx"],
    exclude: [...configDefaults.exclude],
    setupFiles: ["./vitest.dom.setup.ts"],
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
      "@careflow/shared/types/ai": resolve(
        __dirname,
        "../../packages/shared/types/ai.ts",
      ),
      "@careflow/shared": resolve(
        __dirname,
        "../../packages/shared/types/healthcare.ts",
      ),
    },
  },
});
