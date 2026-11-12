import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const API = "http://localhost:3001";
const WEB = "http://localhost:5173";

export default defineConfig({
  testDir: __dirname,
  outputDir: path.join(root, "test-results"),
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: path.join(root, "playwright-report") }]]
    : "list",
  use: { baseURL: WEB, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run start -w @quorum/server",
      cwd: root,
      url: `${API}/dev/users`,
      reuseExistingServer: false,
      env: { DATABASE_URL: "file:./e2e.db", PORT: "3001", WEB_ORIGIN: WEB },
    },
    {
      command: "npm run dev -w @quorum/web",
      cwd: root,
      url: WEB,
      reuseExistingServer: false,
    },
  ],
});
