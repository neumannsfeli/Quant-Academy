import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://qa:qa@localhost:5432/quant_academy_test",
      // The curriculum repository is checked out next to this one.
      CONTENT_BUNDLE: process.env.CONTENT_BUNDLE ?? new URL("../../../Quant-Academy-Curriculum-/dist/content.json", import.meta.url).pathname,
      SERVE_UNREVIEWED_CONTENT: "true",
      RATE_LIMITS: "off",
      MAIL_DIR: "/tmp/qa-test-mail",
      NODE_ENV: "test",
    },
  },
});
