import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * DOM-level component test project (jsdom + Testing Library).
 *
 * Kept separate from vitest.config.ts so the default `npm test` node suite
 * stays hermetic and fast. Run with `npm run test:dom`. Test files use the
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
    },
  },
});
