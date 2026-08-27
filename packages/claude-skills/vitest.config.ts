import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/fixtures/**", "node_modules/**"],
    testTimeout: 20000,
    sequence: { concurrent: false }
  }
});
