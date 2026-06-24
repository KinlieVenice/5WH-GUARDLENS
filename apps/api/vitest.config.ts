import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    fileParallelism: false, // leak/auth tests share the test DB; run serially
    hookTimeout: 60000,
    globalSetup: ["src/tests/helpers/global-setup.ts"],
    env: {
      PLATFORM_ADMINS: JSON.stringify([{ id: "ops-1", label: "Ops", passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$Issgpd3RtzpBTARyM+8MuQ$0OojNeCNzskjPmGo2xtYUQ7/ouMofQTDlqrpOe6MvsM" }]),
    },
  },
});
