import { expect, test, type Page } from "@playwright/test";

const email = `e2e-${Date.now()}@example.com`;
let sandbox = "";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
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
    await expect(card.getByText(/Caught by: Salted content hash/)).toBeVisible();
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
    await expect(card.getByText(/Caught by: Signed Merkle checkpoint/)).toBeVisible();
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
    // Pages render per request now (CSP nonce), so wait for the new page before filling its "Email" field,
    // or the login page's field of the same name gets the text.
    await page.waitForURL("**/forgot-password");
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
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/app");
  });

  test("a passkey can be added, used to sign in, and removed", async ({ page }) => {
    // Chromium's virtual authenticator stands in for Touch ID or a security key.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password456");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/app");

    await page.goto("/app/account");
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await page.getByLabel("Name this passkey").fill("E2E authenticator");
    await page.getByRole("button", { name: "Create passkey" }).click();
    await expect(page.getByText("E2E authenticator")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).first().click();
    await page.waitForURL((u) => !u.pathname.startsWith("/app"));
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await page.waitForURL("**/app");

    await page.goto("/app/account");
    await expect(page.getByText(/last used \w/)).not.toHaveText(/last used never/);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("dialog", { name: "Remove passkey" }).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("E2E authenticator")).toHaveCount(0);
  });

  test("an invite link lets someone else join a space", async ({ page, browser, baseURL }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password456");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/app");
    const { key } = await (await page.request.post("/api/app/spaces", { data: { name: "Shared space" } })).json();
    await page.goto(`/app/${key}/settings`);
    await page.getByRole("button", { name: "Create invite link" }).click();
    const link = await page.locator("code").filter({ hasText: "/invite?token=" }).innerText();

    const guest = `guest-${Date.now()}@example.com`;
    const other = await browser.newContext();
    await other.addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
    const p2 = await other.newPage();
    await p2.goto(link);
    await expect(p2.getByRole("heading", { name: "Join Shared space" })).toBeVisible();
    await p2.getByRole("link", { name: "Create an account" }).click();
    await p2.getByLabel("Name").fill("Guest");
    await p2.getByLabel("Email").fill(guest);
    await p2.getByLabel("Password").fill("password123");
    await p2.getByRole("checkbox").check();
    await p2.getByRole("button", { name: "Create account" }).click();
    await p2.waitForURL("**/invite?token=*");
    await p2.getByRole("button", { name: "Join space" }).click();
    await p2.waitForURL(`**/app/${key}`);
    await other.close();

    await page.reload();
    await expect(page.getByText(guest)).toBeVisible();
  });
});
