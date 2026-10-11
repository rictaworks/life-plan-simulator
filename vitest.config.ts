import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    exclude: ["test/e2e/**"],
    maxWorkers: 2,
    testTimeout: 10000,
  },
});
