import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { e2eKeys } from "../../scripts/lib/e2e-keys";

// Throwaway Ed25519 keys (shared with the build through scripts/e2e-keys.ts, so a build made after that script pins
// the same public key) and a fresh data directory for this run.
const keys = e2eKeys();
const PORT = Number(process.env.E2E_PORT ?? 3100);
const dir = mkdtempSync(join(tmpdir(), "engram-e2e-"));
/** The guest demo needs a space that exists before the server starts; guest.spec.ts seeds this key into it. */
const DEMO_SPACE = "demo0001";
const SEED_TOKEN = "e2e-seed-token";

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
    { name: "desktop", testIgnore: /mobile\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // A phone-width smoke pass: the app has a separate layout below 900px (drawers, the vertical chain strip).
    { name: "phone", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    // Browsers check signatures only with keys built into the bundle (NEXT_PUBLIC_* is inlined at build time), so
    // the app is built with this run's throwaway key before it starts. The key pair is cached in node_modules/.cache,
    // so a build made from the same checkout pins the same key: CI (and a rerun) can skip the ~1 minute rebuild with
    // E2E_SKIP_BUILD=1. Clear that cache or the build and this flag disagree.
    command: `${process.env.E2E_SKIP_BUILD === "1" ? "" : "npx next build && "}npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 400_000,
    env: {
      ENGRAM_BACKEND: "local",
      ENGRAM_DEV_LINKS: "true",
      ENGRAM_LOCAL_DIR: dir,
      CP_PRIVATE_KEY: keys.privateKey,
      CP_KEY_ID: keys.keyId,
      CP_PUBLIC_KEYS: `${keys.keyId}:${keys.publicKey}`,
      NEXT_PUBLIC_CP_PUBLIC_KEY: keys.publicKey,
      NEXT_PUBLIC_CP_PUBLIC_KEYS: `${keys.keyId}:${keys.publicKey}`,
      NEXT_PUBLIC_CP_KEY_ID: keys.keyId,
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
      DEMO_SPACE,
      NEXT_PUBLIC_DEMO_SPACE: DEMO_SPACE,
      SEED_ADMIN_TOKEN: SEED_TOKEN,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
