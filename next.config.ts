import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Lets the e2e suite run its own server next to `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Server-only packages loaded from node_modules at runtime.
  serverExternalPackages: ["pg-boss", "pg", "@prisma/adapter-pg", "unpdf"],
  experimental: {
    // Document uploads are limited to 15 MB (domain); leave room for multipart overhead.
    serverActions: { bodySizeLimit: "16mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
