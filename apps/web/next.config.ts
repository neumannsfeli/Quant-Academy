import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@qa/core", "@qa/db", "@qa/items", "@qa/learning", "@qa/scoring", "@qa/tokens"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: false,
  eslint: { ignoreDuringBuilds: true },
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};

export default config;
