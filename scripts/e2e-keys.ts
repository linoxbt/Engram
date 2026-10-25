/**
 * Prepare the end-to-end checkpoint keys before `pnpm build`, so the build pins the same public key the Playwright
 * server signs with (NEXT_PUBLIC_* values are inlined at build time).
 *   eval "$(pnpm -s tsx scripts/e2e-keys.ts)" && pnpm build && E2E_EXPECT_PINNED=1 pnpm e2e
 *   pnpm tsx scripts/e2e-keys.ts --github-env    # CI: appends the variables to $GITHUB_ENV
 */
import { appendFileSync } from "node:fs";
import { buildEnv, e2eKeys } from "./lib/e2e-keys";

const env = { ...buildEnv(e2eKeys({ fresh: process.argv.includes("--fresh") })), E2E_EXPECT_PINNED: "1" };
if (process.argv.includes("--github-env")) {
  const file = process.env.GITHUB_ENV;
  if (!file) { console.error("GITHUB_ENV is not set"); process.exit(1); }
  appendFileSync(file, Object.entries(env).map(([k, v]) => `${k}=${v}\n`).join(""));
  console.log(`Pinned e2e checkpoint key ${env.NEXT_PUBLIC_CP_PUBLIC_KEYS}`);
} else {
  for (const [k, v] of Object.entries(env)) console.log(`export ${k}=${v}`);
}
