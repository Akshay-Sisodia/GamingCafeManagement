import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["src/test/**/*.test.ts"],
    // Chaos suite needs real infrastructure.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
