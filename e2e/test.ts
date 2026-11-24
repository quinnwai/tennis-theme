// The `test` every spec uses: Playwright's own, plus one opt-in setting. E2E_CPU_THROTTLE=6 makes the browser's processor 6 times slower
// (Chromium's CPU throttling), which is how to see that the checks do not depend on how fast the machine is.

import { test as base } from "@playwright/test";

export const test = base.extend<{ cpuThrottle: void }>({
  cpuThrottle: [
    async ({ page }, use) => {
      const rate = Number(process.env.E2E_CPU_THROTTLE);
      if (rate > 1) await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate });
      await use();
    },
    { auto: true },
  ],
});
