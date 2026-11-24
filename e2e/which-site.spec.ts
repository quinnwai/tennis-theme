// Which site the browser tests are really looking at. Several checkouts can run these checks at the
// same moment, so every run has to be sure that the page it tests is the one it set up: the dev server
// it started itself or, with BASE_URL, the deployed copy it was pointed at.

import { expect } from "@playwright/test";
import { test } from "./test";

if (process.env.BASE_URL) {
  test("against a deployed copy, no dev server is started and the checks use the address they were given", async ({}, testInfo) => {
    expect(testInfo.config.webServer).toBeNull();
    expect(testInfo.project.use.baseURL).toBe(process.env.BASE_URL);
  });
} else {
  test("the page under test comes from the dev server this run started", async ({ page }) => {
    const response = await page.goto("./");
    // Only the server this run started knows the marker; another checkout's server cannot send it.
    const marker = response?.headers()["x-e2e-run"];
    expect(marker).toBeTruthy();
    expect(marker).toBe(process.env.E2E_RUN);
  });
}
