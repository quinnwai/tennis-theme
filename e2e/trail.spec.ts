// The trail of a ball in flight or in the hand, checked in a real browser: what is actually painted
// behind a ball, that it goes away, and that its numbers can be tuned live. Runs against the dev server or, with
// BASE_URL set, against a deployed copy; both only use the page's test hook, window.__sandbox.

import { drawn, freeze, run, until } from "./frozen";
import { expect, type Page } from "@playwright/test";
import { test } from "./test";

interface Ball {
  id: number;
  pinned: boolean;
  held: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/** Call something on window.__sandbox, the page's test hook, and return what it gives back. */
const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const balls = (page: Page) => sandbox<Ball[]>(page, "balls()");
/** Run the simulation forward without waiting for frames. */
const advance = (page: Page, seconds: number) => sandbox<void>(page, `advance(${seconds})`);
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

test("a ball flying up is followed by a solid white band about as wide as the ball, and nothing much wider", async ({ page }, testInfo) => {
  await freeze(page); // the trail's age is the court's time now: it moves a frame at a time, in the loop below
  const d = await dot(page, 0);
  await page.mouse.click(d.x, d.y + d.r * 0.8);
  // While the ball is a few widths up, read the page again and again: where the ball is, and what is
  // painted behind it. Each reading is taken right after a frame, in one go, so the two agree. There
  // are several readings because which frames land in this short stretch differs from run to run.
  const readings = await page.evaluate(
    async ({ id, startY }) => {
      const s = (window as any).__sandbox;
      const canvas = document.getElementById("court") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      const dpr = canvas.width / canvas.clientWidth;
      // The canvas is clear where nothing is drawn (the scene behind it shows through), so the navy is the page's own, and a pixel is
      // read as it looks on screen: its color blended over that navy by its alpha.
      const navy = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) ?? []).slice(0, 3).map(Number);
      const pixel = (x: number, y: number) => {
        const [r, g, b, a] = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
        return [r, g, b].map((v, i) => (v * a + navy[i] * (255 - a)) / 255);
      };
      const background = navy;
      // "Light" is anything clearly brighter than the navy in every color: the trail, not navy or the green ball.
      const light = (p: number[]) => p.every((v, i) => v > background[i] + 50);
      // White at the trail's opacity over the navy: what every pixel inside the band should be, wherever chips overlap.
      const expected = background.map((v) => v + (255 - v) * s.params.trailOpacity);
      const exact = (p: number[]) => p.every((v, i) => Math.abs(v - expected[i]) <= 6);
      const found = [];
      for (let frame = 0; frame < 150 && found.length < 6; frame++) {
        s.advance(1 / 120);
        await new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0)));
        const ball = s.balls().find((b: Ball) => b.id === id) as Ball | undefined;
        if (!ball) continue;
        const rise = (startY - ball.y) / ball.r; // how many radii up it is
        if (rise < 5.5) continue;
        if (rise > 11) break;
        const speed = Math.hypot(ball.vx, ball.vy);
        const along = { x: ball.vx / speed, y: ball.vy / speed };
        const across = { x: -along.y, y: along.x };
        // Points behind the ball (further back than its own edge), at several offsets across its path.
        const sample = (offsets: number[]) => {
          const pixels: number[][] = [];
          for (const back of [1.6, 1.9, 2.2, 2.5, 2.8, 3.1, 3.4]) {
            for (const offset of offsets) {
              pixels.push(
                pixel(
                  ball.x - along.x * back * ball.r + across.x * offset * ball.r,
                  ball.y - along.y * back * ball.r + across.y * offset * ball.r,
                ),
              );
            }
          }
          return pixels;
        };
        const share = (pixels: number[][]) => pixels.filter(light).length / pixels.length;
        const core = sample([-0.5, -0.35, -0.2, 0, 0.2, 0.35, 0.5]);
        const lightCore = core.filter(light);
        found.push({
          // The middle half of the ball's width, and then out toward the edges of the band, wherever the
          // trail width puts them (its half-width in ball radii is the trail width).
          core: share(core),
          edges: share(sample([-0.83, -0.72, 0.72, 0.83].map((f) => f * s.params.trailWidth))),
          // Well outside the ball's width, on both sides.
          outside: share(sample([-2.2, -1.8, -1.5, 1.5, 1.8, 2.2])),
          // Of the painted pixels in the middle, the share that are exactly the flat color.
          flat: lightCore.length ? lightCore.filter(exact).length / lightCore.length : 0,
          speed,
        });
      }
      return found;
    },
    { id: d.id, startY: d.y },
  );
  await testInfo.attach("homepage", { body: await page.screenshot(), contentType: "image/png" });
  expect(readings.length).toBeGreaterThan(0);
  expect(readings.every((r) => r.speed > 300)).toBe(true); // it really was flying
  const best = (key: "core" | "edges" | "flat") => Math.max(...readings.map((r) => r[key]));
  expect(best("core")).toBeGreaterThan(0.9); // solid: the old thin line would score near 0
  expect(best("edges")).toBeGreaterThan(0.4); // as wide as the band is set to, not just its middle
  expect(best("flat")).toBeGreaterThan(0.9); // white at the set opacity, the same wherever chips overlap
  // Never a smear much wider than the ball.
  expect(Math.max(...readings.map((r) => r.outside))).toBeLessThan(0.1);
});

test("once the ball has come to rest its trail is gone within a second, and a resting ball leaves none", async ({ page }) => {
  const d = await dot(page, 0);
  await page.mouse.click(d.x - d.r * 0.6, d.y + d.r * 0.6);
  await expect.poll(() => sandbox<number>(page, "effects().trailPoints")).toBeGreaterThan(10);
  await advance(page, 15); // long enough for the ball to settle, wherever it lands
  const rested = (await balls(page)).find((b) => b.id === d.id)!;
  expect(Math.hypot(rested.vx, rested.vy)).toBeLessThan(5);
  await expect.poll(() => sandbox<number>(page, "effects().trailPoints"), { timeout: 1500, intervals: [50] }).toBe(0);
  // Nothing comes back while the ball sits still.
  await page.waitForTimeout(300);
  expect(await sandbox<number>(page, "effects().trailPoints")).toBe(0);
});

test("a ball being dragged leaves a trail too, and none once it is held still", async ({ page }) => {
  // The court moves only as this check says (a frame's worth of time after each move of the pointer), and the trail is looked at after the
  // page has drawn that frame, so a slow machine cannot change what is seen. How old a trail point is, is the court's time too.
  await freeze(page);
  await page.evaluate("window.__sandbox.params.trailLifetime = 1");
  const d = await dot(page, 0);
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  // Drag it up and to the right over clear space above the name, in big steps so that even if
  // this machine is busy and each step is slow, the ball is still moving well above a crawl.
  let most = 0;
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(d.x + i * 36, d.y - i * 16);
    await run(page, 1 / 30);
    await drawn(page);
    most = Math.max(most, await sandbox<number>(page, "effects().trailPoints"));
  }
  expect((await balls(page)).find((b) => b.id === d.id)!.held).toBe(true);
  expect(most).toBeGreaterThan(10);
  // Hold it still: it catches up with the pointer and stops, and its trail is gone within a second.
  await run(page, 2); // it catches up with the pointer, and then a second of the court's time passes
  await drawn(page);
  expect(await sandbox<number>(page, "effects().trailPoints")).toBe(0);
  expect((await balls(page)).find((b) => b.id === d.id)!.held).toBe(true);
  await page.mouse.up();
});

test("each number of the trail and the poof has a slider under ?tune that moves it", async ({ page }) => {
  await page.goto("./?tune");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  const sliders: [key: string, label: string, value: number][] = [
    ["trailWidth", "trail width", 0.6],
    ["trailPiece", "trail chip size", 0.3],
    ["trailShrink", "trail shrink", 2.5],
    ["trailScatter", "trail scatter", 1.5],
    ["trailLifetime", "trail lifetime", 0.9],
    ["trailOpacity", "trail and poof opacity", 0.5],
    ["poofSize", "poof size", 1.5],
    ["poofLifetime", "poof lifetime", 0.5],
  ];
  for (const [key, label, value] of sliders) {
    const slider = page.getByLabel(label);
    await expect(slider, label).toBeVisible();
    const before = await sandbox<number>(page, `params.${key}`);
    expect(await slider.inputValue(), `${label} starts at the number in use`).toBe(String(before));
    expect(before).not.toBe(value);
    await slider.fill(String(value));
    expect(await sandbox<number>(page, `params.${key}`), `${label} moves ${key}`).toBe(value);
  }
});

test("moving a trail or poof slider leaves a ball in flight alone", async ({ page }) => {
  await page.goto("./?tune");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  await freeze(page);
  // The second dot, because the panel of sliders sits at the left of the window, and in a window as narrow as a phone's it
  // covers the first dot.
  const d = await dot(page, 1);
  await page.mouse.click(d.x, d.y + d.r * 0.8);
  // In flight: rising faster than half a meter a second, which is 300px/s on a laptop and about 160 on a phone held sideways,
  // where a ball is drawn smaller. The hit sends it up at 3 m/s, and it is still rising at that pace for only a quarter of a
  // second, so the ball is looked at every 10 ms: at the default pace of checking, a busy machine can let that quarter second go by.
  const inFlight = -0.5 * (await sandbox<number>(page, "pxPerMeter()"));
  await until(page, async () => (await balls(page)).find((b) => b.id === d.id)?.vy ?? 0, (vy) => vy < inFlight, "the ball is in flight");
  // Read the ball, move the slider and read the ball again without letting a single step of the
  // simulation run in between. Rebuilding the court would leave the ball standing still in mid air.
  const { before, after } = await page.evaluate((id) => {
    const s = (window as any).__sandbox;
    const read = () => {
      const b = s.balls().find((ball: Ball) => ball.id === id) as Ball;
      return { x: b.x, y: b.y, vy: b.vy };
    };
    const slider = (label: string) => [...document.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))!.querySelector("input")!;
    const before = read();
    for (const [label, value] of [["trail lifetime", "1.2"], ["poof size", "1.5"]]) {
      const input = slider(label);
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return { before, after: read() };
  }, d.id);
  expect(before.vy).toBeLessThan(inFlight);
  expect(after).toEqual(before);
});
