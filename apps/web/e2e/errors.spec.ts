import { expect, test, type Page } from "@playwright/test";

const email = `e2e-errors-${Date.now()}@example.com`;
let space = "";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/app");
}

const fail = (page: Page, pattern: string) =>
  page.route(pattern, (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "The backend fell over." } }) }));

test.describe.serial("error paths", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
  });

  test("an account and an empty space to break", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Errors");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/app");
    space = (await (await page.request.post("/api/app/spaces", { data: { name: "Error space" } })).json()).key;
  });

  test("a failed chain fetch is reported, not called an empty chain", async ({ page }) => {
    await signIn(page);
    await fail(page, "**/api/app/spaces/*/chain?*");
    await page.goto(`/app/${space}/chain`);
    await expect(page.getByText("The backend fell over.").first()).toBeVisible();
    await expect(page.getByText("The chain is empty.")).toHaveCount(0);
  });

  test("a failed checkpoint fetch is reported in the checkpoints card", async ({ page }) => {
    await signIn(page);
    await fail(page, "**/api/app/spaces/*/checkpoints");
    await page.goto(`/app/${space}/chain`);
    const card = page.locator("section.card", { hasText: "Signed checkpoints" });
    await expect(card.getByText("The backend fell over.")).toBeVisible();
    await expect(card.getByText("No checkpoints yet")).toHaveCount(0);
  });

  test("a failed capability search says so instead of doing nothing", async ({ page }) => {
    await signIn(page);
    await fail(page, "**/agents/find?*");
    await page.goto(`/app/${space}/agents`);
    const card = page.locator("section.card", { hasText: "Find an agent by capability" });
    await card.getByLabel("Capability").fill("refunds");
    await card.getByRole("button", { name: "Search" }).click();
    await expect(card.getByText("The backend fell over.")).toBeVisible();
  });

  test("a capability search with no matches says so", async ({ page }) => {
    await signIn(page);
    await page.goto(`/app/${space}/agents`);
    const card = page.locator("section.card", { hasText: "Find an agent by capability" });
    await card.getByLabel("Capability").fill("nobody does this");
    await card.getByRole("button", { name: "Search" }).click();
    await expect(card.getByText(/No agent matches that/)).toBeVisible();
  });

  test("a read_only refusal becomes a sign-up prompt, not a red error", async ({ page }) => {
    await signIn(page);
    await page.route("**/agents/find?*", (r) => r.fulfill({
      status: 403, contentType: "application/json",
      body: JSON.stringify({ error: { code: "read_only", message: "This is a read-only demo." } }),
    }));
    await page.goto(`/app/${space}/agents`);
    const card = page.locator("section.card", { hasText: "Find an agent by capability" });
    await card.getByLabel("Capability").fill("refunds");
    await card.getByRole("button", { name: "Search" }).click();
    await expect(card.getByRole("link", { name: "Create a free account" })).toHaveAttribute("href", "/signup");
    await expect(card.locator('[role="alert"]')).toHaveCount(0);
  });

  test("the public verifier refuses an empty or short key with a message", async ({ page }) => {
    await page.goto("/verify");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Space keys are 8 lowercase letters or digits.")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/verify");
    await page.getByLabel("Space key").fill("abc1234");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Space keys are 8 lowercase letters or digits.")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/verify");
    await page.getByLabel("Space key").fill(space);
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL(`**/verify/${space}`);
  });
});
