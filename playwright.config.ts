import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "test/e2e",
  timeout: 30000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
    screenshot: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "npm run dev -- --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: "npx tsx test/e2e/server.fixture.ts",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
