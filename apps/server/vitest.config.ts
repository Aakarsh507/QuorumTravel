import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { DATABASE_URL: "file:./test.db" },
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 30000,
    fileParallelism: false, // tests share one SQLite file
  },
});
