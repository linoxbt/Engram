import { expect, test, type Page } from "@playwright/test";

const email = `e2e-${Date.now()}@example.com`;
let sandbox = "";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app");
}

test.describe("cookie consent", () => {
  test("signing up waits for cookies, and the policies are linked from the banner", async ({ page }) => {
    await page.goto("/signup");
    const banner = page.getByRole("dialog", { name: "Engram uses cookies" });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/legal/privacy");
    await banner.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText("Engram needs cookies to keep you signed in")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
    await page.getByRole("button", { name: "Accept cookies" }).click();
    await expect(page.getByText("Engram needs cookies to keep you signed in")).toHaveCount(0);
    // The server enforces the same rule for clients that skip the page.
    const res = await page.request.post("/api/auth/login", { data: { email: "x@example.com", password: "x" }, headers: { cookie: "" } });
    expect([401, 403]).toContain(res.status());
  });
});

test.describe.serial("signature path", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
  });

  test("sign up and create a seeded, publicly verifiable sandbox", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Name").fill("E2E");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/app");
    await page.getByRole("button", { name: /New sandbox/ }).click();
    await page.getByRole("switch", { name: "Public verification" }).click();
    await page.getByRole("button", { name: /^Create$/ }).click();
    await expect(page.getByText("Demo agent keys")).toBeVisible();
    await page.getByRole("button", { name: "Open the space" }).click();
    await page.waitForURL(/\/app\/[a-z0-9]{8}$/);
    sandbox = page.url().split("/").pop()!;
    await expect(page.getByText("Open conflicts")).toBeVisible();
  });

  test("the browser verifier proves the chain", async ({ page }) => {
    await signIn(page);
    await page.goto(`/app/${sandbox}/chain`);
    await page.getByRole("button", { name: /Verify in this browser/ }).click();
    await expect(page.getByText(/Verified through #\d+\. Signed/)).toBeVisible();
  });

  test("recall finds the downgrade, and the conflict is in the inbox", async ({ page }) => {
    await signIn(page);
    await page.goto(`/app/${sandbox}/memories`);
    await page.getByLabel("Search memories").fill("What plan is Ada on?");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Ada downgraded from the Pro plan to Basic on 22 October.").first()).toBeVisible();
    await page.goto(`/app/${sandbox}/conflicts`);
    await expect(page.getByText(/disagree\. Choose which is right/)).toBeVisible();
    await page.getByRole("button", { name: "A is right" }).click();
    await expect(page.getByText(/Recorded as entry #\d+/)).toBeVisible();
  });

  test("Tamper Lab: an edited memory is caught at the exact entry", async ({ page }) => {
    await signIn(page);
    await page.goto(`/app/${sandbox}/lab`);
    const card = page.locator("section.card", { hasText: "Edit the text" });
    await card.getByRole("button", { name: "Attack" }).click();
    await expect(card.getByText(/Changed the text of #\d+/)).toBeVisible();
    await card.getByRole("button", { name: /Verify/ }).click();
    await expect(card.getByText(/Caught\. Content hash/)).toBeVisible();
  });

  test("Tamper Lab: rewriting later history is caught by the signed checkpoint", async ({ page }) => {
    await signIn(page);
    await page.goto(`/app/${sandbox}/lab`);
    await page.getByRole("button", { name: /Reset sandbox/ }).click();
    await expect(page.getByText(/Sandbox restored/)).toBeVisible();
    const card = page.locator("section.card", { hasText: "Rewrite all later history" });
    await card.getByRole("button", { name: "Attack" }).click();
    await expect(card.getByText(/Rewrote #\d+/)).toBeVisible();
    await card.getByRole("button", { name: /Verify/ }).click();
    await expect(card.getByText(/Caught\. Signed checkpoint/)).toBeVisible();
    await page.getByRole("button", { name: /Reset sandbox/ }).click();
    await expect(page.getByText(/Sandbox restored/).last()).toBeVisible();
  });

  test("agent keys come with connection snippets", async ({ page }) => {
    await signIn(page);
    await page.goto(`/app/${sandbox}/agents`);
    await page.getByRole("button", { name: /New agent/ }).click();
    await page.getByLabel("Name").fill("e2e-agent");
    await page.getByLabel("Description").fill("End-to-end test agent");
    await page.getByRole("button", { name: /Create key/ }).click();
    await expect(page.getByText(/claude mcp add --transport http engram/)).toBeVisible();
  });

  test("the public verifier works without login and never shows text", async ({ page }) => {
    await page.goto(`/verify/${sandbox}`);
    await expect(page.getByText(/Verified through #\d+\./)).toBeVisible();
    await expect(page.getByText("Ada downgraded")).toHaveCount(0);
  });

  test("a forgotten password can be reset from the emailed link", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/a reset link is on its way/)).toBeVisible();
    // The local backend cannot send email, so it shows the link instead.
    await page.getByRole("link", { name: "open the reset link" }).click();
    await page.getByLabel("New password", { exact: true }).fill("password456");
    await page.getByLabel("Confirm new password").fill("password456");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password456");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/app");
  });
});
