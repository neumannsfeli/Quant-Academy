import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// One .env at the repo root serves the web app, the jobs runner and the db scripts.
const rootEnv = new URL("../../.env", import.meta.url).pathname;
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

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
