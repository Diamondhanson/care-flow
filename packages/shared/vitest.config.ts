import { defineConfig } from "vitest/config";

// Minimal node-environment unit-test setup for the shared package (mirrors
// apps/web/vitest.config.ts). Today this runs the schema ↔ types enum-parity
// guard in types/enum-parity.test.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
