import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
