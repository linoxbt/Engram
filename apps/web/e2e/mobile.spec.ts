import { expect, test } from "@playwright/test";

/** A small phone-width smoke pass: the layout below 900px is a different one (drawers, vertical lists). */
const email = `e2e-phone-${Date.now()}@example.com`;

test.describe.serial("at phone width", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: "engram_consent", value: "accepted", url: baseURL! }]);
  });

  test("the landing page works and its menu opens", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Verified through #\d+ · signature valid/)).toBeVisible();
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("link", { name: "Docs" })).toBeVisible();
  });

  test("the public verifier form fits and validates", async ({ page }) => {
    await page.goto("/verify");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("Space keys are 8 lowercase letters or digits.")).toBeVisible();
  });

  test("the console opens, with its navigation in a drawer", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Name").fill("Phone");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/app");
    await expect(page.getByRole("heading", { name: "Spaces" })).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("link", { name: "Agent keys" })).toBeVisible();
  });
});
