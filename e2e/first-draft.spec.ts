// The checks that say the first draft is done (see "The first draft is done when" in ROADMAP.md),
// run in a real browser against the dev server or, with BASE_URL set, against a deployed copy.

import { expect, test, type Page } from "@playwright/test";

/** One ball as the page's test hook reports it. Screen units: px and px/s, y down. */
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

interface Point {
  x: number;
  y: number;
}

/** Call something on window.__sandbox, the page's test hook, and return what it gives back. */
const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const balls = (page: Page) => sandbox<Ball[]>(page, "balls()");
const ball = async (page: Page, id: number) => (await balls(page)).find((b) => b.id === id)!;
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

test("a click under a ball sends it up", async ({ page }) => {
  const d = await dot(page, 0);
  await page.mouse.click(d.x, d.y + d.r * 0.8);
  const hit = await sandbox<{ id: number; dir: Point }>(page, "lastHit()");
  expect(hit.id).toBe(d.id);
  expect(hit.dir.y).toBeLessThan(-0.95);
  await advance(page, 1 / 240);
  const after = await ball(page, d.id);
  expect(after.pinned).toBe(false);
  expect(after.vy).toBeLessThan(0);
  expect(Math.abs(after.vx)).toBeLessThan(Math.abs(after.vy) * 0.2);
});

test("a click at a ball's bottom left sends it up and to the right, along the line through its center", async ({ page }) => {
  const d = await dot(page, 1);
  const click = { x: d.x - d.r * 0.6, y: d.y + d.r * 0.6 };
  await page.mouse.click(click.x, click.y);
  const hit = await sandbox<{ dir: Point }>(page, "lastHit()");
  const length = Math.hypot(d.x - click.x, d.y - click.y);
  const expected = { x: (d.x - click.x) / length, y: (d.y - click.y) / length };
  expect(hit.dir.x * expected.x + hit.dir.y * expected.y).toBeGreaterThan(0.99);
  await advance(page, 1 / 240);
  const after = await ball(page, d.id);
  expect(after.vx).toBeGreaterThan(0);
  expect(after.vy).toBeLessThan(0);
});

test("pressing and holding a ball lets you drag it around", async ({ page }) => {
  const d = await dot(page, 0);
  const target = { x: d.x + 150, y: d.y - 160 };
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(d.x + 60, d.y - 80, { steps: 10 });
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await expect
    .poll(async () => {
      const b = await ball(page, d.id);
      return Math.hypot(b.x - target.x, b.y - target.y);
    })
    .toBeLessThan(6);
  expect((await ball(page, d.id)).held).toBe(true);
  await page.mouse.up();
  expect((await ball(page, d.id)).held).toBe(false);
});

test("pressing, moving and letting go throws the ball the way it was moving", async ({ page }) => {
  const d = await dot(page, 0);
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(d.x + 400, d.y - 100, { steps: 5 });
  await page.waitForTimeout(80); // the ball is still chasing the pointer when it is let go
  await page.mouse.up();
  const thrown = await ball(page, d.id);
  expect(thrown.held).toBe(false);
  expect(thrown.vx).toBeGreaterThan(300);
  expect(Math.abs(thrown.vy)).toBeLessThan(thrown.vx);
});

test("a hit shows a pow, and a ball in flight leaves a trail", async ({ page }) => {
  const d = await dot(page, 0);
  await page.mouse.click(d.x - d.r * 0.6, d.y + d.r * 0.6);
  await expect.poll(() => sandbox<number>(page, "effects().bursts"), { intervals: [10] }).toBeGreaterThan(0);
  await expect.poll(() => sandbox<number>(page, "effects().trailPoints")).toBeGreaterThan(3);
});

test("balls bounce off the floor and the side walls", async ({ page }) => {
  const d = await dot(page, 1);
  // Carry the right-hand dot toward the right wall and let it go while it is still moving.
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(1400, d.y + 40, { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  const seen = await page.evaluate((id) => {
    const s = (window as any).__sandbox;
    const find = () => s.balls().find((b: Ball) => b.id === id) as Ball | undefined;
    let prev = find()!;
    const seen = { lost: false, right: 0, bottom: 0, offWall: false, offFloor: false, width: innerWidth, height: innerHeight };
    for (let i = 0; i < 720; i++) {
      s.advance(1 / 120);
      const b = find();
      if (!b) {
        seen.lost = true;
        break;
      }
      seen.right = Math.max(seen.right, b.x + b.r);
      seen.bottom = Math.max(seen.bottom, b.y + b.r);
      if (prev.vx > 60 && b.vx < -60) seen.offWall = true;
      if (prev.vy > 60 && b.vy < -60) seen.offFloor = true;
      prev = b;
    }
    return seen;
  }, d.id);
  expect(seen.lost).toBe(false);
  expect(seen.offWall).toBe(true);
  expect(seen.offFloor).toBe(true);
  expect(seen.right).toBeLessThan(seen.width + 2);
  expect(seen.bottom).toBeLessThan(seen.height + 2);
});

test("balls bounce off the letters and each other", async ({ page }) => {
  // Letters: set a ball down above the first "n" and it comes to rest on the name, not inside it or under it.
  const first = await dot(page, 0);
  const above = await page.evaluate(() => {
    const letters = (window as any).__sandbox.layout().letters;
    const n = letters.find((l: { char: string }) => l.char === "n").loops.flat() as Point[];
    const xs = n.map((p) => p.x);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...n.map((p) => p.y)) - 90 };
  });
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(first.x, above.y, { steps: 8 });
  await page.mouse.move(above.x, above.y, { steps: 8 });
  await expect.poll(async () => Math.hypot((await ball(page, first.id)).x - above.x, (await ball(page, first.id)).y - above.y)).toBeLessThan(6);
  await page.waitForTimeout(120); // let it stop before letting go, so it drops straight down
  await page.mouse.up();
  await advance(page, 5);
  const rested = await page.evaluate((id) => {
    const s = (window as any).__sandbox;
    const b = s.balls().find((ball: Ball) => ball.id === id) as Ball;
    const layout = s.layout();
    const inside = (p: Point, loop: Point[]) => {
      let hit = false;
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i];
        const c = loop[j];
        if (a.y > p.y !== c.y > p.y && p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x) hit = !hit;
      }
      return hit;
    };
    const loops = layout.letters.flatMap((l: { loops: Point[][] }) => l.loops) as Point[][];
    return { speed: Math.hypot(b.vx, b.vy), y: b.y, baseline: layout.origin.y, insideALetter: loops.some((loop) => inside(b, loop)) };
  }, first.id);
  expect(rested.speed).toBeLessThan(1);
  expect(rested.insideALetter).toBe(false);
  expect(rested.y).toBeLessThan(rested.baseline);

  // Each other: carry that ball into the other dot, which comes loose.
  const second = await dot(page, 1);
  const carried = await ball(page, first.id);
  await page.mouse.move(carried.x, carried.y);
  await page.mouse.down();
  await page.mouse.move(carried.x, second.y - 120, { steps: 8 });
  await page.mouse.move(second.x - 120, second.y - 120, { steps: 8 });
  await page.mouse.move(second.x - 120, second.y, { steps: 8 });
  await page.mouse.move(second.x + 60, second.y, { steps: 8 });
  await expect.poll(async () => (await ball(page, second.id)).pinned).toBe(false);
  await page.mouse.up();
});

test("the name is clearly readable in a screenshot", async ({ page }, testInfo) => {
  await expect(page.locator("h1")).toHaveText("quinn wai");
  // Find one point inside the ink of every letter, then read what the canvas actually painted there.
  const read = () =>
    page.evaluate(() => {
      const s = (window as any).__sandbox;
      const canvas = document.getElementById("court") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      const dpr = canvas.width / canvas.clientWidth;
      const pixel = (p: Point) => [...ctx.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data.slice(0, 3)];
      const inside = (p: Point, loop: Point[]) => {
        let hit = false;
        for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
          const a = loop[i];
          const c = loop[j];
          if (a.y > p.y !== c.y > p.y && p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x) hit = !hit;
        }
        return hit;
      };
      const letters = s.layout().letters as { char: string; loops: Point[][] }[];
      const ink = letters.map((letter) => {
        const points = letter.loops.flat();
        const left = Math.min(...points.map((p) => p.x));
        const right = Math.max(...points.map((p) => p.x));
        const top = Math.min(...points.map((p) => p.y));
        const bottom = Math.max(...points.map((p) => p.y));
        for (let gy = 1; gy < 12; gy++) {
          for (let gx = 1; gx < 12; gx++) {
            const p = { x: left + ((right - left) * gx) / 12, y: top + ((bottom - top) * gy) / 12 };
            // Inside an odd number of loops means inside a stroke rather than inside a hole such as the bowl of the q.
            if (letter.loops.filter((loop) => inside(p, loop)).length % 2 === 1) return pixel(p);
          }
        }
        return null;
      });
      return { ink, background: pixel({ x: canvas.clientWidth / 2, y: 40 }) };
    });
  await expect.poll(async () => (await read()).ink.every((rgb) => rgb && rgb.every((v) => v > 250))).toBe(true);
  const { ink, background } = await read();
  expect(ink).toHaveLength(8);
  // Contrast between the letters and the background, by the usual accessibility formula. 7 is the strictest bar for text.
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  expect((luminance(ink[0]!) + 0.05) / (luminance(background) + 0.05)).toBeGreaterThan(7);
  await testInfo.attach("homepage", { body: await page.screenshot(), contentType: "image/png" });
});

test("the contact control opens, and its links go to the right places", async ({ page }) => {
  const contact = page.getByRole("navigation", { name: "Contact" });
  const email = contact.getByRole("link", { name: "Email" });
  const github = contact.getByRole("link", { name: "GitHub" });
  const linkedin = contact.getByRole("link", { name: "LinkedIn" });
  await expect(email).toBeHidden();
  await contact.getByRole("button", { name: "Contact" }).click();
  await expect(email).toBeVisible();
  await expect(email).toHaveAttribute("href", "mailto:quinnwai.wong@gmail.com");
  await expect(github).toHaveAttribute("href", "https://github.com/quinnwai");
  await expect(github).toHaveAttribute("target", "_blank");
  await expect(linkedin).toHaveAttribute("href", "https://www.linkedin.com/in/quinn-wai-wong/");
  await expect(linkedin).toHaveAttribute("target", "_blank");
});

test("the credits page loads from the homepage and leads back", async ({ page }) => {
  await page.getByRole("link", { name: "Credits" }).click();
  await expect(page).toHaveURL(/\/credits\/$/);
  await expect(page.getByRole("heading", { name: "credits" })).toBeVisible();
  await expect(page.getByText("Monument Valley")).toBeVisible();
  await page.getByRole("link", { name: /back/ }).click();
  await expect(page.locator("#court")).toBeVisible();
  await expect(page).not.toHaveURL(/credits/);
});

test("a dot always comes back, and the clear button sweeps the court", async ({ page }) => {
  for (let round = 0; round < 3; round++) {
    const d = await dot(page, 0);
    await page.mouse.click(d.x - d.r * 0.8, d.y + d.r * 0.2);
    await advance(page, 4);
    expect((await sandbox<boolean[]>(page, "dots()"))[0]).toBe(true);
  }
  expect((await balls(page)).length).toBe(5);
  await page.getByRole("button", { name: "Clear the balls" }).click();
  expect((await balls(page)).length).toBe(0);
  await advance(page, 0.5);
  expect(await sandbox<boolean[]>(page, "dots()")).toEqual([true, true]);
  expect((await balls(page)).length).toBe(2);
});
