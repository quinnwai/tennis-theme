// QWW-101 (step 2 of QWW-99): the drop preview, written before the change by chief-keef. While a can is carried, a dark shadow of it
// shows where it will come to rest, from the same settle simulation that runs on let go, so the can lands where the shadow was. The
// shadow glides after the predicted spot, fades while the can moves fast (0.45 to 1.4 m/s), and fades out and back in rather than
// jumping. The spec is QWW-99's description ("The drop preview").
//
// What these checks ask of the test hook, window.__sandbox, beyond what step 1 added:
// - rest(id): where the carried can `id` would come to rest if let go now, { x, y, angle } (page px; radians clockwise, like cans()),
//   or null when it is not carried
// - ghosts(): the drop-preview shadows as last drawn, one per carried can: { id, x, y, angle, alpha } (page px, radians clockwise,
//   alpha 0 to 1). In a frozen court (QWW-95) the shadow's glide and fade run on the court's clock, as the trail and the pow do, so
//   `advance` moves them and a slow machine does not.
//
// The accuracy runs follow the prototype's checks/check-v7.mjs ("preview"): a can is pressed, carried somewhere at random, sometimes
// flicked, then either held still for 1.8 s (so whatever it pushed has stopped) or let go at once (while balls may still be rolling).
// A hit is a can that stands within 6 px and 2 degrees of where the preview said, the moment it was let go. Seeded, so a failure
// repeats. Nothing here may be weakened to pass; a check that is wrong is argued on QWW-101.

import { freeze, run, until, drag, drawn } from "./frozen";
import { expect, type Page } from "@playwright/test";
import { test } from "./test";

interface Can {
  id: number;
  x: number;
  y: number;
  angle: number;
  held: boolean;
  height: number;
  state: string;
}
interface Ball {
  id: number;
  x: number;
  y: number;
  r: number;
}
interface Pose {
  x: number;
  y: number;
  angle: number;
}
interface Ghost extends Pose {
  id: number;
  alpha: number;
}

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const cans = (page: Page) => sandbox<Can[]>(page, "cans()");
const can = async (page: Page, id: number) => (await cans(page)).find((c) => c.id === id)!;
const balls = (page: Page) => sandbox<Ball[]>(page, "balls()");
const rest = (page: Page, id: number) => sandbox<Pose | null>(page, `rest(${id})`);
const ghosts = (page: Page) => sandbox<Ghost[]>(page, "ghosts()");
const addCan = (page: Page, x: number, y: number) => sandbox<number>(page, `addCan(${x}, ${y})`);
const deg = (radians: number) => (radians * 180) / Math.PI;
/** The difference between two turns, in degrees, whole turns apart counting as the same. */
const turn = (a: number, b: number) => Math.abs(((deg(a - b) + 540) % 360) - 180);

/** mulberry32: a small seeded random number generator. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far a point is from a can's outline (0 on it or inside it): the court's own rule, `canGap` in src/input.ts. */
function gap(c: Can, width: number, p: { x: number; y: number }) {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const across = Math.abs(dx * Math.cos(c.angle) + dy * Math.sin(c.angle));
  const along = Math.abs(-dx * Math.sin(c.angle) + dy * Math.cos(c.angle));
  return Math.hypot(Math.max(across - width / 2, 0), Math.max(along - c.height / 2, 0));
}

/**
 * A point on the can to press it by: on its long axis, out of every ball's reach (a ball near the pointer is taken first), and where the
 * court would give the press to this can, not to another one standing there (the nearest outline wins, and the later can when two tie).
 */
async function pressPoint(page: Page, c: Can) {
  const all = await balls(page);
  const others = (await cans(page)).filter((o) => o.id !== c.id);
  const len = c.height / 2;
  for (const f of [0, 0.35, -0.35, 0.7, -0.7, 0.85, -0.85]) {
    const p = { x: c.x - Math.sin(c.angle) * len * f, y: c.y + Math.cos(c.angle) * len * f };
    if (!all.every((b) => Math.hypot(b.x - p.x, b.y - p.y) > b.r + 18)) continue;
    const mine = gap(c, c.width, p);
    if (others.every((o) => (o.id > c.id ? gap(o, o.width, p) > mine : gap(o, o.width, p) >= mine))) return p;
  }
  return null;
}

/** Three cans and a handful of loose balls, at seeded places, for the cans to land on, against and among. */
async function court(page: Page, rand: () => number) {
  const { width, height } = page.viewportSize()!;
  const ids: number[] = [];
  for (const f of [0.15, 0.5, 0.8]) ids.push(await addCan(page, width * f, height * 0.3));
  for (let i = 0; i < 6; i++) await sandbox(page, `drop(${40 + rand() * (width - 80)}, ${40 + rand() * height * 0.4})`);
  await run(page, 4);
  return ids;
}

/** `trials` carries and let-goes; gives how many came to rest where the preview said. */
async function accuracy(page: Page, seed: number, trials: number, still: (i: number) => boolean) {
  const rand = seeded(seed);
  const ids = await court(page, rand);
  const { width: w, height: h } = page.viewportSize()!;
  let hits = 0;
  const misses: unknown[] = [];
  for (let i = 0; i < trials; i++) {
    // the can whose turn it is, or the next one if nobody can press it; a miss only when no can can be pressed
    let id = ids[i % ids.length];
    let c = await can(page, id);
    let at = await pressPoint(page, c);
    for (let k = 1; !at && k < ids.length; k++) {
      id = ids[(i + k) % ids.length];
      c = await can(page, id);
      at = await pressPoint(page, c);
    }
    if (!at) {
      // balls and cans all round: knock them about and count it as a miss, so a crowded court cannot pass by being skipped
      misses.push({ i, note: "no can has a clear point to press" });
      await sandbox(page, `drop(${c.x}, ${Math.max(20, c.y - 200)})`);
      await run(page, 2);
      continue;
    }
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    const to = { x: 40 + rand() * (w - 80), y: 40 + rand() * (h - 100) };
    await drag(page, at, to, 2 + Math.floor(rand() * 10));
    let end = to;
    if (rand() < 0.5) {
      end = { x: to.x + (rand() - 0.5) * 120, y: to.y };
      await drag(page, to, end, 2);
    }
    if (still(i)) await run(page, 1.8);
    const said = await rest(page, id);
    await page.mouse.up();
    // a can may also leave: thrown past a side line it goes back to the bag (it no longer stops at the top), which is a hit when the preview said so
    const after = await until(
      page,
      async () => (await cans(page)).find((x) => x.id === id) ?? null,
      (x) => x === null || x.state === "placed",
      `trial ${i}: the can comes to stand or leaves`,
      6,
    );
    if (!after) {
      if (said && (said.x < 0 || said.x > w)) hits++;
      else misses.push({ i, said, note: "the can left the court" });
      ids[ids.indexOf(id)] = await addCan(page, w * 0.5, h * 0.3);
      await run(page, 1);
      continue;
    }
    const landed = after;
    const d = said ? Math.hypot(landed.x - said.x, landed.y - said.y) : Infinity;
    const da = said ? turn(landed.angle, said.angle) : Infinity;
    if (d <= 6 && da <= 2) hits++;
    else misses.push({ i, said, landed: { x: landed.x, y: landed.y, angle: landed.angle }, px: d, deg: da });
  }
  return { hits, misses };
}

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (e) => seen.push(String(e)));
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  await freeze(page);
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page), "the page raised no errors").toEqual([]);
});

test.describe("the drop preview: the can lands where its shadow showed", () => {
  test("on a desktop, at least 99 of 100 drops held still", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "the desktop run");
    test.setTimeout(240_000);
    const { hits, misses } = await accuracy(page, 1101, 100, () => true);
    expect(hits, `misses: ${JSON.stringify(misses.slice(0, 5))}`).toBeGreaterThanOrEqual(99);
  });

  test("on a desktop, at least 95 of 100 drops let go at once", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "the desktop run");
    test.setTimeout(240_000);
    const { hits, misses } = await accuracy(page, 1102, 100, () => false);
    expect(hits, `misses: ${JSON.stringify(misses.slice(0, 5))}`).toBeGreaterThanOrEqual(95);
  });

  test("at 750 x 280, at least 49 of 50 drops, half held still and half let go at once", async ({ page }, info) => {
    test.skip(info.project.name !== "iphone-landscape", "the 750 x 280 phone");
    test.setTimeout(240_000);
    const { hits, misses } = await accuracy(page, 1103, 50, (i) => i % 2 === 0);
    expect(hits, `misses: ${JSON.stringify(misses.slice(0, 5))}`).toBeGreaterThanOrEqual(49);
  });
});

test.describe("a can thrown up past the window's top (QWW-113)", () => {
  test("goes above the window, as a ball does, and lands where its shadow showed", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium" && info.project.name !== "iphone-landscape", "a desktop and the 750 x 280 phone");
    const { width } = page.viewportSize()!;
    // to the right of the name's middle, clear of the corner controls
    const id = await addCan(page, width * 0.62, 60);
    const c = await until(page, () => can(page, id), (x) => x.state === "placed", "the can stands", 4);
    const at = (await pressPoint(page, c))!;
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    // a quick swing straight up to the window's top edge, let go while it is still moving up
    await drag(page, at, { x: at.x, y: 2 }, 4);
    const said = await rest(page, id);
    expect(said, "a shadow to land on").not.toBeNull();
    await page.mouse.up();
    let highest = Infinity;
    const landed = await until(
      page,
      async () => {
        const x = await can(page, id);
        // the top of its outline, in page pixels from the window's top (negative is above the window)
        const top = x.y - (x.width / 2) * Math.abs(Math.sin(x.angle)) - (x.height / 2) * Math.abs(Math.cos(x.angle));
        highest = Math.min(highest, top);
        return x;
      },
      (x) => x.state === "placed",
      "the can comes to stand",
      6,
    );
    expect(highest, "its top went at least 20 px above the window's top").toBeLessThan(-20);
    expect(Math.hypot(landed.x - said!.x, landed.y - said!.y), "within 6 px of its shadow").toBeLessThanOrEqual(6);
    expect(turn(landed.angle, said!.angle), "within 2 degrees of its shadow").toBeLessThanOrEqual(2);
  });
});

test.describe("the drop preview's shadow", () => {
  /** A can standing on the open floor, pressed and lifted a little, so it is carried and still. */
  async function carried(page: Page) {
    const { height } = page.viewportSize()!;
    const id = await addCan(page, 120, height * 0.3);
    const c = await until(page, () => can(page, id), (x) => x.state === "placed", "the can stands", 4);
    const at = (await pressPoint(page, c))!;
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    const up = { x: at.x + 40, y: at.y - 40 };
    await drag(page, at, up, 6);
    return { id, at: up };
  }
  const shadowOf = async (page: Page, id: number) => (await ghosts(page)).find((g) => g.id === id) ?? null;

  test("shows only while a can is carried, and once it is held still it is solid and where the can will rest", async ({ page }) => {
    const { height } = page.viewportSize()!;
    const id = await addCan(page, 120, height * 0.3);
    await until(page, () => can(page, id), (x) => x.state === "placed", "the can stands", 4);
    await drawn(page);
    expect(await shadowOf(page, id), "no shadow for a can nobody holds").toBeNull();
    const { id: held } = await carried(page);
    await run(page, 1);
    await drawn(page);
    const g = await shadowOf(page, held);
    const r = await rest(page, held);
    expect(g, "a shadow while it is carried").not.toBeNull();
    expect(r).not.toBeNull();
    expect(g!.alpha, "solid once the hand is still").toBeGreaterThan(0.9);
    expect(Math.hypot(g!.x - r!.x, g!.y - r!.y), "drawn where the can will rest (px)").toBeLessThan(2);
    await page.mouse.up();
    await run(page, 0.5);
    await drawn(page);
    expect(await shadowOf(page, held), "gone once it is let go").toBeNull();
  });

  test("fades while the can is swung fast, comes back as the hand slows, and never jumps while it shows", async ({ page }) => {
    const { id, at } = await carried(page);
    await run(page, 1);
    const ppm = await sandbox<number>(page, "pxPerMeter()");
    const { width } = page.viewportSize()!;
    // swing it at about 2 m/s, well past 1.4 m/s, for half a second, a frame at a time
    const step = (2 * ppm) / 60;
    let x = at.x;
    let dir = 1;
    let faintest = 1;
    let previous: Ghost | null = await shadowOf(page, id);
    let worstJump = 0;
    const height = (await can(page, id)).height;
    const watch = async () => {
      await drawn(page);
      const g = await shadowOf(page, id);
      if (g && previous && g.alpha > 0.2 && previous.alpha > 0.2) worstJump = Math.max(worstJump, Math.hypot(g.x - previous.x, g.y - previous.y));
      previous = g;
      return g;
    };
    for (let i = 0; i < 30; i++) {
      if (x + dir * step > width - 60 || x + dir * step < 60) dir = -dir;
      x += dir * step;
      await page.mouse.move(x, at.y);
      await run(page, 1 / 60);
      const g = await watch();
      faintest = Math.min(faintest, g?.alpha ?? 0);
    }
    expect(faintest, "faded out while swung fast").toBeLessThan(0.15);
    // now hold still: it comes back
    let back = 0;
    for (let i = 0; i < 60; i++) {
      await run(page, 1 / 60);
      back = (await watch())?.alpha ?? 0;
    }
    expect(back, "back once the hand is still").toBeGreaterThan(0.9);
    expect(worstJump, "while it shows, it glides: never more than half a can's height in a frame (px)").toBeLessThan(height / 2);
    await page.mouse.up();
  });
});
