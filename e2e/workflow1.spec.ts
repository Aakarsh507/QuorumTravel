import { expect, test } from "@playwright/test";

/**
 * SYS-02 / Workflow 1: Miami Spring Break 2027.
 * Seed state: Maya and Jordan have submitted preferences, Alex has not.
 * Screens: 1 Your trips -> 3 My travel preferences -> 4 Ready to generate
 *          -> 5 Review and vote -> 6 Majority approved.
 */
test("Alex, Maya and Jordan plan the Miami trip and confirm it", async ({ page }) => {
  // Screen 1: Your trips (dev session defaults to Alex)
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back, Alex!" })).toBeVisible();
  await page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Miami Spring Break 2027" }) })
    .getByRole("link", { name: "View trip" })
    .click();
  await expect(page).toHaveURL(/\/trips\/[^/]+$/);
  const tripUrl = page.url();

  // Screen 3: My travel preferences
  await page.goto(`${tripUrl}/preferences`);
  await expect(page.getByRole("heading", { name: "My travel preferences" })).toBeVisible();
  await page.getByLabel("From").fill("2027-03-12");
  await page.getByLabel("To").fill("2027-03-18");
  await page.getByLabel(/Maximum budget/).fill("1500");
  await page.getByLabel("Departure airport").fill("IND");
  await page.getByRole("button", { name: "Beach" }).click();
  await page.getByRole("button", { name: "Food" }).click();
  await page.getByRole("button", { name: "Save preferences" }).click();

  // Screen 4: Ready to generate
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole("heading", { name: /Ready to find your group/ })).toBeVisible();
  await expect(page.getByText("3 of 5 travelers are ready")).toBeVisible();
  await page.getByRole("button", { name: "Generate group plan" }).click();

  // Screen 5: Review and vote
  await expect(page.getByText("Voting open")).toBeVisible();
  await expect(page.getByText("0 accepted", { exact: true })).toBeVisible();

  const accept = page.getByRole("button", { name: "Accept plan" });
  await accept.click();
  await expect(page.getByText("1 accepted", { exact: true })).toBeVisible();

  await page.getByLabel("Viewing as").selectOption({ label: "Maya Chen" });
  await accept.click();
  await expect(page.getByText("2 accepted", { exact: true })).toBeVisible();

  await page.getByLabel("Viewing as").selectOption({ label: "Jordan Lee" });
  await accept.click();

  // Screen 6: Majority approved
  await expect(page.getByRole("heading", { name: "Your group plan is confirmed" })).toBeVisible();
  await expect(page.getByText("3 accepted", { exact: true })).toBeVisible();
});
