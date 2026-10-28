import { expect, test, type Page } from "@playwright/test";

/** Must match playwright.config.ts: the server reads DEMO_SPACE at request time, so the key is fixed up front. */
const DEMO_SPACE = "demo0001";
const SEED_TOKEN = "e2e-seed-token";
const owner = `demo-owner-${Date.now()}@example.com`;
const PASSWORD = "password123";

/** No write control may be offered to a guest; each of these used to open and then fail with a 403. */
const WRITE_CONTROLS = ["New space", "New sandbox", "Edit name", "Change password", "Resend link", "Delete account", "Add a passkey"];

async function expectNoWriteControls(page: Page) {
  for (const name of WRITE_CONTROLS) await expect(page.getByRole("button", { name })).toHaveCount(0);
}

test.describe.serial("the read-only guest demo", () => {
  test("the demo space is seeded under the key the server was started with", async ({ request, page, baseURL }) => {
    test.setTimeout(240_000);
    await page.context().addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Demo owner");
    await page.getByLabel("Email").fill(owner);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/app");

    const res = await request.post("/api/admin/seed", {
      timeout: 220_000,
      headers: { authorization: `Bearer ${SEED_TOKEN}`, "x-owner-password": PASSWORD },
      data: { ownerEmail: owner, variant: "sandbox", key: DEMO_SPACE, name: "Northwind support", publicVerify: true },
    });
    expect(res.status(), await res.text()).toBe(200);
  });

  test("entering the demo signs in a guest who can read the space", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
    const page = await ctx.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: /Explore the live demo/ }).click();
    await page.waitForURL(`**/app/${DEMO_SPACE}`);
    await expect(page.getByText("You are exploring the live demo as a guest")).toBeVisible();
    // Reads a viewer is refused are not offered as pages at all.
    const sidebar = page.locator('aside[aria-label="Space navigation"]');
    await expect(sidebar.getByRole("link", { name: "Memories" })).toBeVisible();
    for (const hidden of ["Agents", "Recall audit", "Settings", "Tamper Lab"]) {
      await expect(sidebar.getByRole("link", { name: hidden })).toHaveCount(0);
    }
    await ctx.close();
  });

  test("a guest sees no write control on the workspace screens", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
    const page = await ctx.newPage();
    expect((await page.request.post("/api/demo/enter")).ok()).toBe(true);

    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Spaces" })).toBeVisible();
    await expectNoWriteControls(page);
    await expect(page.getByRole("link", { name: "Create a free account" }).first()).toHaveAttribute("href", "/signup");

    await page.goto("/app/account");
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    // The passkeys card renders its own prompt, so wait for it before counting controls.
    await expect(page.getByText("A demo guest cannot add a passkey.")).toBeVisible();
    await expectNoWriteControls(page);
    await expect(page.getByRole("link", { name: "Create a free account" }).first()).toBeVisible();
    await ctx.close();
  });

  test("a guest's chain carries headers and hashes, never a content salt", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
    const page = await ctx.newPage();
    expect((await page.request.post("/api/demo/enter")).ok()).toBe(true);

    const res = await page.request.get(`/api/app/spaces/${DEMO_SPACE}/chain?limit=500`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    // A salt beside a content hash is what makes a guessed text checkable offline. /export is closed to a
    // viewer for exactly this; reading the same documents one page at a time must not reopen it.
    expect(body).not.toContain("salt");
    const { entries } = JSON.parse(body) as { entries: { $id: string; h?: unknown; hash?: string; metadata?: unknown }[] };
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.metadata).toBeUndefined();
      expect(e.h).toBeDefined();
      expect(typeof e.hash).toBe("string");
    }
    // Deep mode has nothing to hand a viewer either: vectors carry the meaning of the text.
    const deep = await page.request.get(`/api/app/spaces/${DEMO_SPACE}/chain?limit=5&vectors=1`);
    const deepBody = (await deep.json()) as { entries: { vector?: number[] }[] };
    for (const e of deepBody.entries) expect(e.vector).toBeUndefined();
    await ctx.close();
  });

  test("the guest chain page still draws the chain from headers alone", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
    const page = await ctx.newPage();
    expect((await page.request.post("/api/demo/enter")).ok()).toBe(true);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`/app/${DEMO_SPACE}/chain`);
    // Entries with no `metadata` used to throw here and leave a guest an empty page.
    await expect(page.getByRole("heading", { name: /Chain/ }).first()).toBeVisible();
    await expect(page.locator('[data-testid="chain-strip"], svg, canvas').first()).toBeVisible({ timeout: 15_000 });
    expect(errors, errors.join("\n")).toEqual([]);
    await ctx.close();
  });

  test("a member of the same account still sees every write control", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
    await page.goto("/login");
    await page.getByLabel("Email").fill(owner);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/app");
    await expect(page.getByRole("button", { name: "New space" })).toBeVisible();
    await page.goto("/app/account");
    await expect(page.getByRole("button", { name: "Edit name" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete account" })).toBeVisible();
  });
});
