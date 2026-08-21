import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    // Unit tests only; integration/chaos suite runs via `test:integration`.
    include: ["src/modules/**/*.test.ts"],
  },
});
