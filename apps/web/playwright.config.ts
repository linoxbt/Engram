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

/** Only reuse an existing build when it was made with this run's pinned checkpoint key. */
function reuseBuild(): boolean {
  if (process.env.E2E_SKIP_BUILD !== "1") return false;
  const pinned = `${keys.keyId}:${keys.publicKey}`;
  if (process.env.NEXT_PUBLIC_CP_PUBLIC_KEYS !== pinned) {
    throw new Error(`E2E_SKIP_BUILD=1 needs a build made with NEXT_PUBLIC_CP_PUBLIC_KEYS=${pinned}: run \`eval "$(pnpm -s tsx scripts/e2e-keys.ts)" && pnpm build\` first, or drop the flag.`);
  }
  // `next start` says so loudly if there is no build at all.
  return true;
}

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
    // the app is built with this run's throwaway key before it starts. CI already does that build (it runs
    // scripts/e2e-keys.ts, then `pnpm build`), so E2E_SKIP_BUILD=1 reuses it and saves the ~1 minute duplicate.
    // It is refused unless that build really pinned this run's key, because a plain `pnpm build` pins none and the
    // browser verifier would then quietly fall back to the server's key.
    command: `${reuseBuild() ? "" : "npx next build && "}npx next start -p ${PORT}`,
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
