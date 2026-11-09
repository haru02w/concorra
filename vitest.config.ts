import { defineConfig } from "vitest/config";

/**
 * Headless end-to-end tests: real Next.js server + worker + Postgres + RustFS,
 * every external API mocked (MOCK_EXTERNAL=true). See tests/global-setup.ts.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/**/*.e2e.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 300_000,
  },
});
