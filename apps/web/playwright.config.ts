import { defineConfig, devices } from "@playwright/test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway Ed25519 keys and data directory for this run.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const raw = (der: Buffer) => der.subarray(der.length - 32).toString("hex");
const PORT = 3100;
const dir = mkdtempSync(join(tmpdir(), "engram-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
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
      CP_PRIVATE_KEY: raw(privateKey.export({ format: "der", type: "pkcs8" }) as Buffer),
      NEXT_PUBLIC_CP_PUBLIC_KEY: raw(publicKey.export({ format: "der", type: "spki" }) as Buffer),
      CP_KEY_ID: "e2e",
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
