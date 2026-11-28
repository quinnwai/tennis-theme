// A ball resting against the bag's left end goes behind it, as a ball beside the bench's left end does (QWW-114, item 10 of Quinn-Wai's
// review of PR #22). The balls land on the bag's outline half way back, so a ball at rest against its left end overlaps the drawn front
// panel's bulging end (by about a third to three quarters of its disc, depending on the window), yet the whole bag is drawn under the
// canvas and the ball shows in front of it. Wanted: the bag's front-left is drawn over the part of the ball behind it, shut and open.
//
// What is in view is measured on the screen itself, not from any layer's markup: the ball's disc is shot once as the page draws it and
// once with the canvas hidden, and the pixels that differ are the part of the ball the eye sees. So the check holds however the bag is
// drawn over the ball. Every project runs it (the phones held sideways too, with a mouse), at 1280 x 800, at the iPhone's 750 x 280 and
// at the 852 x 282 Quinn-Wai's iPhone showed on the preview.

import { expect, type Page } from "@playwright/test";
import { test } from "./test";
import { drawn, freeze, run } from "./frozen";

type Pt = [number, number];

interface Ball {
  id: number;
  held: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface Layout {
  k: number;
  benchSurfaceY: number;
  bagAt: Pt;
}

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const balls = (page: Page) => sandbox<Ball[]>(page, "balls()");
const ball = async (page: Page, id: number) => (await balls(page)).find((b) => b.id === id)!;

const WINDOWS = [
  { width: 1280, height: 800 },
  { width: 750, height: 280 },
  { width: 852, height: 282 },
];

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (e) => seen.push(String(e)));
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page), "the page raised no errors").toEqual([]);
});

/** Open the page at `size`, unzipped if `open`, then stop its clock. */
async function bagPage(page: Page, size: { width: number; height: number }, open: boolean) {
  await page.setViewportSize(size);
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  if (open) {
    const from = (await sandbox<{ pull: Pt }>(page, "bag()")).pull;
    const end = await sandbox<Pt>(page, "zipPoint(1)");
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    await page.mouse.move(end[0], end[1], { steps: 14 });
    await page.mouse.up();
    await expect.poll(async () => (await sandbox<{ open: boolean }>(page, "bag()")).open).toBe(true);
    await page.waitForTimeout(1000); // what is in the bag comes up
  }
  await freeze(page);
  const L = await sandbox<Layout>(page, "scene()");
  const r = (await balls(page))[0].r;
  // the drawn front panel's left end (its bulge), page px, from the page's own art
  const face = await page.evaluate(async (L: Layout) => {
    const art = await import(/* @vite-ignore */ "/src/v6/art.ts");
    return (art.sampleF() as Pt[]).map((p) => [L.bagAt[0] + (p[0] - art.BAG_ANCHOR[0]) * L.k, L.bagAt[1] + p[1] * L.k] as Pt);
  }, L);
  return { L, r, faceLeft: Math.min(...face.map((p) => p[0])), faceRight: Math.max(...face.map((p) => p[0])), faceTop: Math.min(...face.map((p) => p[1])) };
}

/**
 * Put a ball at rest on the seat against the bag's left end: the furthest right on the seat a ball let go there stays put (the court
 * pushes one let go any further right out of the bag). Found by trying, so it follows the bag's outline wherever it is.
 */
async function ballAgainstEnd(page: Page, L: Layout, r: number, faceLeft: number) {
  const y = L.benchSurfaceY - r - 0.5;
  let rest = NaN;
  for (let x = faceLeft - 3 * r; x < faceLeft + 3 * r; x += r / 10) {
    const id = await sandbox<number>(page, `drop(${x}, ${y})`);
    await run(page, 0.5);
    const b = await ball(page, id);
    await sandbox(page, `remove(${id})`);
    if (Math.abs(b.x - x) > 1 || b.y < y - 1) break;
    rest = x;
  }
  expect(Number.isFinite(rest), "a ball let go on the seat left of the bag stays there").toBe(true);
  const id = await sandbox<number>(page, `drop(${rest}, ${y})`);
  await run(page, 2);
  const b = await ball(page, id);
  expect(Math.hypot(b.vx, b.vy), "it is at rest").toBeLessThan(2);
  return b;
}

/**
 * The share of a ball's disc that is in view: shot as drawn and with the canvas hidden, the pixels that differ. The racquet's layer
 * (`.v6-front`, over everything) is hidden for both shots, so that only what the bag hides counts: its handle stands near the bag's end.
 */
async function inView(page: Page, b: Ball) {
  await page.evaluate(() => ((document.querySelector(".v6-front") as HTMLElement).style.visibility = "hidden"));
  const clip = { x: Math.floor(b.x - b.r - 2), y: Math.floor(b.y - b.r - 2), width: Math.ceil(2 * b.r + 4), height: Math.ceil(2 * b.r + 4) };
  await drawn(page);
  const shown = (await page.screenshot({ clip, scale: "css" })).toString("base64");
  await page.evaluate(() => (document.querySelector("canvas")!.style.visibility = "hidden"));
  await drawn(page);
  const without = (await page.screenshot({ clip, scale: "css" })).toString("base64");
  await page.evaluate(() => (document.querySelector("canvas")!.style.visibility = ""));
  await page.evaluate(() => ((document.querySelector(".v6-front") as HTMLElement).style.visibility = ""));
  await drawn(page);
  return page.evaluate(
    async ({ shown, without, b, clip }) => {
      const pixels = async (png: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
        const c = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
        c.drawImage(bitmap, 0, 0);
        return c.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const A = await pixels(shown);
      const B = await pixels(without);
      let all = 0;
      let seen = 0;
      for (let y = 0; y < A.height; y++)
        for (let x = 0; x < A.width; x++) {
          const dx = clip.x + x + 0.5 - b.x;
          const dy = clip.y + y + 0.5 - b.y;
          if (dx * dx + dy * dy > (b.r - 1) ** 2) continue; // inside the disc, clear of its anti-aliased edge
          all++;
          const i = 4 * (y * A.width + x);
          if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 40) seen++;
        }
      return seen / all;
    },
    { shown, without, b, clip },
  );
}

test.describe("the bag's left end", () => {
  for (const open of [false, true]) {
    test(`a ball resting against it, with the bag ${open ? "open" : "shut"}, shows only its back part, and a press on that part takes it`, async ({ page }) => {
      test.setTimeout(180_000);
      for (const size of WINDOWS) {
        const at = `${size.width}x${size.height}`;
        const { L, r, faceLeft } = await bagPage(page, size, open);
        const b = await ballAgainstEnd(page, L, r, faceLeft);
        expect(b.x, `it rests against the bag's drawn end, overlapping it, at ${at}`).toBeGreaterThan(faceLeft - r);
        const share = await inView(page, b);
        // Today the whole ball is in view (0.94 to 1). Behind the bag's front-left, only its back part shows: still enough to see and take.
        expect(share, `only the ball's back part is in view at ${at}`).toBeLessThan(0.8);
        expect(share, `enough of it is in view to see at ${at}`).toBeGreaterThan(0.15);

        // the part in view is its left, the side away from the bag; a press there takes it. (Low on that side: on a phone the zip pull's
        // fingertip-sized button reaches down over the top of a ball here while the bag is shut, and takes a press there first.)
        const grip: Pt = [b.x - b.r * 0.5, b.y + b.r * 0.5];
        await page.mouse.move(grip[0], grip[1]);
        await page.mouse.down();
        for (let i = 1; i <= 4; i++) {
          await page.mouse.move(grip[0] - 8 * i, grip[1] - 10 * i);
          await run(page, 1 / 60);
        }
        expect((await ball(page, b.id)).held, `a press on the ball's visible part takes it at ${at}`).toBe(true);
        await page.mouse.up();
      }
    });
  }

  test("a ball just left of the end, or on top of the bag, is wholly in view", async ({ page }) => {
    test.setTimeout(180_000);
    for (const size of WINDOWS) {
      for (const open of [false, true]) {
        const at = `${size.width}x${size.height}, the bag ${open ? "open" : "shut"}`;
        const { L, r, faceLeft, faceRight, faceTop } = await bagPage(page, size, open);
        // on the seat, a ball's width clear of the bag's drawn end
        const clear = await sandbox<number>(page, `drop(${faceLeft - 2.2 * r}, ${L.benchSurfaceY - r - 0.5})`);
        await run(page, 1);
        expect(await inView(page, await ball(page, clear)), `a ball on the seat clear of the bag is wholly in view at ${at}`).toBeGreaterThan(0.95);
        await sandbox(page, `remove(${clear})`);
        // up on the bag, toward its left end: on its top when shut, on its top or a can's lid when open
        const x = faceLeft + 0.35 * (faceRight - faceLeft);
        const onTop = await sandbox<number>(page, `drop(${x}, ${faceTop - 3 * r})`);
        await run(page, 1);
        const t = await ball(page, onTop);
        expect(t.y, `it rests up on the bag, not on the seat, at ${at}`).toBeLessThan(L.benchSurfaceY - 2 * r);
        expect(await inView(page, t), `a ball resting up on the bag is wholly in view at ${at}`).toBeGreaterThan(0.95);
        await sandbox(page, `remove(${onTop})`);
      }
    }
  });
});
