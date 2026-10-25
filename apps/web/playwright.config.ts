import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { e2eKeys } from "../../scripts/lib/e2e-keys";

// Throwaway Ed25519 keys (shared with the build through scripts/e2e-keys.ts, so a build made after that script pins
// the same public key) and a fresh data directory for this run.
const keys = e2eKeys();
const PORT = 3100;
const dir = mkdtempSync(join(tmpdir(), "engram-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ENGRAM_BACKEND: "local",
      ENGRAM_DEV_LINKS: "true",
      ENGRAM_LOCAL_DIR: dir,
      CP_PRIVATE_KEY: keys.privateKey,
      CP_KEY_ID: keys.keyId,
      CP_PUBLIC_KEYS: `${keys.keyId}:${keys.publicKey}`,
      NEXT_PUBLIC_CP_PUBLIC_KEY: keys.publicKey,
      NEXT_PUBLIC_CP_KEY_ID: keys.keyId,
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
