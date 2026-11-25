// Checks that must give the same answer on any machine stop the page's own clock and move time themselves.
//
// `freeze` stops the real-time frame loop of the toy (window.__sandbox.freeze, see src/main.ts). From then on the court moves only when a
// check calls `advance`, and a press is timed by the court's clock: a tap, a hold and a carry last as long as the check says, however slow
// the browser or the machine is. `until` is `expect.poll` in the court's time.

import { expect, type Page } from "@playwright/test";

export const freeze = (page: Page) => page.evaluate("window.__sandbox.freeze()");

/** Run the court forward `seconds` of its own time (the same as the page's `advance`). */
export const run = (page: Page, seconds: number) => page.evaluate(`window.__sandbox.advance(${seconds})`);

/**
 * Run the court forward a frame at a time until `read` gives something that `ok` accepts, and give that. Fails if it takes more than
 * `maxSeconds` of the court's time (never of the machine's), so a slow machine cannot make it fail and a broken toy cannot make it pass.
 * `step` is how much court time passes between looks. Each look is a round trip to the browser (about 10 ms), so a wait of many seconds
 * for something whose time is in the page's own log can look less often; the court still runs frame by frame in between.
 */
export async function until<T>(page: Page, read: () => Promise<T>, ok: (value: T) => boolean, what: string, maxSeconds = 5, step = 1 / 60): Promise<T> {
  let value = await read();
  for (let t = 0; !ok(value); t += step) {
    expect(t, `${what}: within ${maxSeconds} s of the court's time (last seen: ${JSON.stringify(value)})`).toBeLessThan(maxSeconds);
    await run(page, step);
    value = await read();
  }
  return value;
}

/** Wait for the page to draw two frames, so that what a frame records (the trail's points) has been recorded for the court as it stands. */
export const drawn = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

/**
 * Move the held pointer from one point to another in `moves` small moves, a frame of the court's time after each (a single
 * `mouse.move` with `steps` sends every step before the court has run once, which the court takes as a violent shake).
 */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, moves: number) {
  for (let i = 1; i <= moves; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / moves, from.y + ((to.y - from.y) * i) / moves);
    await run(page, 1 / 60);
  }
}
