import { expect, test } from "@playwright/test";

/** Docs pages must not scroll sideways on a phone: wide tables scroll inside their own wrapper. */
test.describe("docs at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const path of ["/docs", "/docs/concepts", "/docs/mcp", "/docs/api", "/docs/deploy"]) {
    test(`${path} has no horizontal page overflow`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("article.docs h1")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
