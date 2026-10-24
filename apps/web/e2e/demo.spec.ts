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

test.describe.serial("signature path", () => {
  test("sign up and create a seeded, publicly verifiable sandbox", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Name").fill("E2E");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
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
});
