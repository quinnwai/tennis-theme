// The poof where a ball is hit, checked in a real browser: that a starburst of chips is actually
// painted around the point that was struck, and that it is gone soon after. Runs against the dev
// server or, with BASE_URL set, against a deployed copy; both only use the page's test hook,
// window.__sandbox.

import { expect, type Page } from "@playwright/test";
import { drawn, freeze, run } from "./frozen";
import { test } from "./test";

interface Ball {
  id: number;
  pinned: boolean;
  x: number;
  y: number;
  r: number;
}

/** Call something on window.__sandbox, the page's test hook, and return what it gives back. */
const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
/** The ball currently sitting as the dot of the first or second "i". */
const dot = (page: Page, index: number) =>
  page.evaluate((i) => {
    const s = (window as any).__sandbox;
    const home = s.layout().dots[i];
    return s.balls().find((b: Ball) => b.pinned && Math.hypot(b.x - home.x, b.y - home.y) < 2) as Ball;
  }, index);

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
});

test("a hit bursts into a chunky white star around the point it was struck, and it is gone once its lifetime is up", async ({ page }, testInfo) => {
  // Slow the poof down to a third of its pace, so the star stays readable for about three times
  // as long and a busy machine cannot make the readings miss it. Its shape is the same.
  await freeze(page); // the burst's age is the court's time now, which moves only in the loop below, a frame at a time
  await page.evaluate("window.__sandbox.params.poofLifetime = 1");
  const d = await dot(page, 0);
  const click = { x: d.x - d.r * 0.6, y: d.y + d.r * 0.6 };
  await page.mouse.click(click.x, click.y);
  // In the first moments after the hit, read what is painted in rings around the point that was
  // struck: how many of the points on them are light, and in how many directions. Each reading is
  // taken right after a frame. There are several because which frames land in the window differs from run to run.
  const readings = await page.evaluate(
    async ({ id, at }) => {
      const s = (window as any).__sandbox;
      const canvas = document.getElementById("court") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      const dpr = canvas.width / canvas.clientWidth;
      const pixel = (x: number, y: number) => [...ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data.slice(0, 3)];
      const background = pixel(canvas.clientWidth / 2, 40);
      // "Light" is anything clearly brighter than the navy in every color: the white of a chip, not navy or the green ball.
      const light = (p: number[]) => p.every((v, i) => v > background[i] + 50);
      const found: { lit: number; total: number; directions: number }[] = [];
      for (let frame = 0; frame < 12; frame++) {
        s.advance(1 / 120);
        await new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0)));
        const ball = s.balls().find((b: Ball) => b.id === id) as Ball;
        let lit = 0;
        let total = 0;
        const directions = new Set<number>();
        // Directions that fall between the points of any regular star: 32 of them, off the usual angles.
        // The rings grow with the poof size, so they cross the star wherever its size puts it.
        for (let k = 0; k < 32; k++) {
          for (const ring of [1.2, 1.7, 2.2].map((f) => f * s.params.poofSize)) {
            const a = ((k + 0.37) / 32) * Math.PI * 2;
            const x = at.x + Math.cos(a) * ring * ball.r;
            const y = at.y + Math.sin(a) * ring * ball.r;
            if (Math.hypot(x - ball.x, y - ball.y) < ball.r + 2) continue; // behind the ball itself
            total++;
            if (light(pixel(x, y))) {
              lit++;
              directions.add(Math.floor(k / 4));
            }
          }
        }
        found.push({ lit, total, directions: directions.size });
      }
      return found;
    },
    { id: d.id, at: click },
  );
  await testInfo.attach("homepage", { body: await page.screenshot(), contentType: "image/png" });
  expect(readings.length).toBeGreaterThan(0);
  // A starburst lights a good share of the points on the rings, all the way round them. The old eight thin spikes lit under a fifth, in three or four directions.
  expect(Math.max(...readings.map((r) => r.lit / r.total))).toBeGreaterThan(0.4);
  expect(Math.max(...readings.map((r) => r.directions))).toBeGreaterThanOrEqual(7);
  // And it is gone once its lifetime is up.
  await run(page, 1.2);
  await drawn(page);
  expect(await sandbox<number>(page, "effects().bursts")).toBe(0);
});
