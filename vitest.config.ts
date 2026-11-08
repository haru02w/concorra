import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.int.test.ts", "src/**/*.e2e.test.ts", "node_modules/**"],
  },
});
