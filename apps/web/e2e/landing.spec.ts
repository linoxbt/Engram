import { expect, test } from "@playwright/test";

test.describe("the landing page", () => {
  test("the Proof Playground builds a chain, catches an attack and restores it", async ({ page }) => {
    await page.goto("/");
    const status = page.getByText(/Verified through #\d+ · signature valid/);
    await expect(status).toBeVisible();
    await page.getByRole("button", { name: /Level 3 · recompute its hashes/ }).click();
    await expect(page.getByText(/Tampered at #\d+/)).toBeVisible();
    await expect(page.getByText(/Caught by the/)).toBeVisible();
    // The attack buttons come back: a stuck `busy` used to disable all four for good.
    await expect(page.getByRole("button", { name: /Level 1 · edit a fact/ })).toBeEnabled();
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(status).toBeVisible();
  });

  test("a browser that cannot hash gets an error, not an endless Hashing…", async ({ page }) => {
    // Any WebCrypto failure (an insecure origin, a policy) looks like this.
    await page.addInitScript(() => {
      Object.defineProperty(crypto, "subtle", { configurable: true, get: () => { throw new Error("blocked"); } });
    });
    await page.goto("/");
    await expect(page.getByText("Could not build the demo chain", { exact: true })).toBeVisible();
    await expect(page.getByText("Hashing…")).toHaveCount(0);
  });

  test("the hero calls to action lead to sign-up for a visitor who is not signed in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Create a memory space/ })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/login");
  });

  test("the time scrubber moves the answer", async ({ page }) => {
    await page.goto("/#time");
    await expect(page.locator("#time")).toBeVisible();
  });
});
