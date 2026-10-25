import { expect, test, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { e2eKeys } from "../../../scripts/lib/e2e-keys";

/** Demo beats not covered by demo.spec.ts: the Time Machine, and forgetting without breaking the chain. */
const email = `beats-${Date.now()}@example.com`;
let space = "";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/app");
}

test.describe.serial("demo beats", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
  });

  test("a space with the demo story is created through the API", async ({ page }) => {
    const signup = await page.request.post("/api/auth/signup", { data: { email, password: "password123", name: "Beats", acceptTerms: true } });
    expect(signup.ok(), await signup.text()).toBe(true);
    const res = await page.request.post("/api/app/spaces", { data: { name: "Beats demo", seed: "demo" } });
    expect(res.ok(), await res.text()).toBe(true);
    const body = await res.json();
    space = body.key;
    // Seeding runs in short slices; keep asking until the story is written.
    for (let done = !!body.seeding?.done, i = 0; !done && i < 60; i++) {
      const r = await page.request.post(`/api/app/spaces/${space}/seed`);
      expect(r.ok(), await r.text()).toBe(true);
      done = (await r.json()).done;
    }
  });

  test("Time Machine: as of Tuesday shows the old plan, now shows the downgrade, and Prove it replays the chain", async ({ page }) => {
    await signIn(page);
    await page.goto(`/app/${space}/time`);
    await expect(page.getByRole("heading", { name: "Time Machine" })).toBeVisible();
    // With the demo story loaded, the page asks "What plan is Ada on?" as of 20 October, midday.
    const then = page.locator("section.card").filter({ hasText: /^Then/ });
    const now = page.locator("section.card").filter({ hasText: /^Now/ });
    await expect(then.getByText("Ada is on the Pro plan, billed monthly.")).toBeVisible();
    await expect(then.getByText("Ada downgraded from the Pro plan to Basic on 22 October.")).toHaveCount(0);
    await expect(now.getByText("Ada downgraded from the Pro plan to Basic on 22 October.")).toBeVisible();
    await expect(then.getByText(/superseded by #\d+/)).toBeVisible();

    await then.getByRole("button", { name: "Prove it" }).click();
    await expect(then.getByText(/Replayed \d+ chain entries from #0 instead of trusting derived fields\. Same answer\./)).toBeVisible();

    await page.getByRole("button", { name: "Now", exact: true }).click();
    await expect(then.getByText("Ada downgraded from the Pro plan to Basic on 22 October.")).toBeVisible();
  });

  test("forgetting a memory erases its text and the chain still verifies in the browser", async ({ page }) => {
    await signIn(page);
    const found = await page.request.post(`/api/app/spaces/${space}/recall`, { data: { query: "Where should the hardware token be delivered for Ada?", k: 5 } });
    expect(found.ok(), await found.text()).toBe(true);
    const target = ((await found.json()).memories as { id: string; text: string | null }[]).find((m) => m.text?.includes("14 Palm Close"));
    expect(target, "the seeded delivery address").toBeTruthy();
    const forgot = await page.request.post(`/api/app/spaces/${space}/memories/${target!.id}/forget`, { data: { reason: "Customer asked to be forgotten" } });
    expect(forgot.ok(), await forgot.text()).toBe(true);

    const again = await page.request.post(`/api/app/spaces/${space}/recall`, { data: { query: "Where should the hardware token be delivered for Ada?", k: 5 } });
    expect(JSON.stringify(await again.json())).not.toContain("14 Palm Close");

    await page.goto(`/app/${space}/chain`);
    await page.getByRole("button", { name: /Verify in this browser/ }).click();
    await expect(page.getByText(/Verified through #\d+\./)).toBeVisible();
    await expect(page.getByText(/Memory #\d+ was changed after it was written/)).toHaveCount(0);
  });

  test("the build pins the e2e checkpoint key", async () => {
    // CI generates the key before `pnpm build` (scripts/e2e-keys.ts), so NEXT_PUBLIC_CP_PUBLIC_KEYS is inlined and the
    // browser verifies signatures with its built-in key instead of the server's.
    test.skip(process.env.E2E_EXPECT_PINNED !== "1", "set E2E_EXPECT_PINNED=1 after building with scripts/e2e-keys.ts");
    const pub = e2eKeys().publicKey;
    const dir = join(__dirname, "..", ".next", "static");
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p); } };
    if (existsSync(dir)) walk(dir);
    expect(files.some((f) => readFileSync(f, "utf8").includes(pub))).toBe(true);
  });
});
