import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    fileParallelism: false, // leak/auth tests share the test DB; run serially
    hookTimeout: 60000,
    globalSetup: ["src/tests/helpers/global-setup.ts"],
  },
});
