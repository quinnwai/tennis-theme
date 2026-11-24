// The bench, the bag, the notebook and the cans of balls (QWW-85, the v6 design), checked in a real browser: where the bench stands, that
// balls land on it and on the bag, that the bag is unzipped by its pull, what comes out of it, and what the notebook does. The same
// checks run on every project, the phones held sideways included (with a mouse; the finger checks are in bench-bag.phone.spec.ts).
// Everything goes through the page's test hook, window.__sandbox. The court's own rules are in src/cans.test.ts.

import { freeze, until } from "./frozen";
import { expect, type Page } from "@playwright/test";
import { test } from "./test";
import { notebookText } from "../src/notebook-text";

type Pt = [number, number];

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

interface Can {
  id: number;
  seed: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  held: boolean;
  ballsLeft: number;
  width: number;
  height: number;
}

interface Layout {
  k: number;
  width: number;
  height: number;
  benchX: number;
  benchFrontTop: number;
  benchSurfaceY: number;
  floorFrontY: number;
  bagAt: Pt;
  shows: number;
  sink: number;
  scale: number;
}

interface Bag {
  zip: number;
  open: boolean;
  notebookOut: boolean;
  pull: Pt;
}

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const balls = (page: Page) => sandbox<Ball[]>(page, "balls()");
const cans = (page: Page) => sandbox<Can[]>(page, "cans()");
const scene = (page: Page) => sandbox<Layout>(page, "scene()");
const bag = (page: Page) => sandbox<Bag>(page, "bag()");
const advance = (page: Page, seconds: number) => sandbox<void>(page, `advance(${seconds})`);
const notebookDialog = (page: Page) => page.getByRole("dialog", { name: "Notebook" });

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (e) => seen.push(String(e)));
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page), "the page raised no errors").toEqual([]);
});

/** Take hold of the bag's pull and drag it along the zip to `to` (0 to 1), in steps; let go if `release`. */
async function dragPull(page: Page, to: number, release = true) {
  const from = (await bag(page)).pull;
  const end = await sandbox<Pt>(page, `zipPoint(${to})`);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(end[0], end[1], { steps: 14 });
  if (release) await page.mouse.up();
}

/** Unzip the bag by its pull, and give what is in it the time to come up. */
async function unzip(page: Page) {
  await dragPull(page, 1);
  await expect.poll(async () => (await bag(page)).open).toBe(true);
  await page.waitForTimeout(1000);
}

/** Where the part of item `i` of the bag that shows is, as the page draws it: [left, top, width] of its box. */
const itemBox = (page: Page, i: number) =>
  page.evaluate((i) => {
    const r = document.querySelectorAll(".v6-rise")[i].getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }, i);

/** The three cans in the bag, in order, and the notebook. */
// (the order of ITEMS in src/v6/art.ts: the cans left to right, then the notebook)
const canIndexes = [0, 1, 2];

/** The bench as the page draws it: the box round its seat, front and right side. */
const benchBox = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector(".v6-back .v6-art")!.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });

/** Click the notebook standing in the open bag: the button laid over the part of it that shows. */
const openNotebook = (page: Page) => page.getByRole("button", { name: "Open the notebook" }).click();

/** The point on the top of a can standing in the open bag where a press takes hold of it. */
async function canTop(page: Page, n: number) {
  const box = await itemBox(page, canIndexes[n]);
  return { x: box.left + box.width / 2, y: box.top + 8 };
}

/**
 * Move the pointer from one point to another the way a hand does: in many small moves, each followed by a frame's worth of time
 * (a single mouse.move with `steps` sends every step before the court has run once, which the court takes as a violent shake).
 */
async function carry(page: Page, from: Pt, to: Pt, moves = 30) {
  for (let i = 1; i <= moves; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / moves, from[1] + ((to[1] - from[1]) * i) / moves);
    await advance(page, 1 / 60);
  }
}

/** The windows the scene is laid out for: a laptop, a big monitor, a tablet, a phone held sideways in two browsers and a short desktop window. */
const WINDOWS = [
  { width: 1440, height: 800 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
  { width: 844, height: 390 },
  { width: 750, height: 280 },
];

test.describe("the bench", () => {
  test("stands right of the middle, is cut off by the bottom of the window, and the bag stands on its seat", async ({ page }) => {
    for (const size of WINDOWS) {
      await page.setViewportSize(size);
      await expect.poll(async () => (await scene(page)).width).toBe(size.width);
      const L = await scene(page);
      const at = `${size.width}x${size.height}`;
      const box = await benchBox(page);
      expect((box.left + box.right) / 2, `the bench's middle is right of the middle of the window at ${at}`).toBeGreaterThan(size.width / 2);
      expect(L.benchFrontTop, `the bench starts above the bottom edge at ${at}`).toBeLessThan(size.height);
      expect(L.floorFrontY, `and goes on below it at ${at}`).toBeGreaterThan(size.height);
      expect(L.bagAt[0], `the bag is right of the middle at ${at}`).toBeGreaterThan(size.width / 2);
      expect(L.bagAt[1], `the bag stands on the seat, above the window's bottom at ${at}`).toBeLessThan(size.height);
      expect(L.bagAt[1], `and not above the seat's front edge by more than the bag is deep at ${at}`).toBeGreaterThan(L.benchFrontTop - 200 * L.k);
    }
  });

  test("never sits under a corner button, at any window size", async ({ page }) => {
    for (const size of WINDOWS) {
      await page.setViewportSize(size);
      await expect.poll(async () => (await scene(page)).width).toBe(size.width);
      const L = await scene(page);
      const buttons = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".chip, .contact .toggle")]
          .filter((b) => b.getBoundingClientRect().width > 0)
          .map((b) => {
            const r = b.getBoundingClientRect();
            return { name: b.getAttribute("aria-label"), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
          }),
      );
      expect(buttons.length, "the corner buttons are there to be checked").toBeGreaterThanOrEqual(4);
      // The bench's whole outline: its seat and front, from its left end to its right end and from the top of its seat to the window's bottom.
      void L;
      const bench = await benchBox(page);
      for (const b of buttons) {
        const overlaps = b.left < bench.right && b.right > bench.left && b.top < bench.bottom && b.bottom > bench.top;
        expect(overlaps, `the bench is not under the ${b.name} button at ${size.width}x${size.height}`).toBe(false);
      }
    }
  });
});

const LEFT_END_WINDOWS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 844, height: 390 },
];

/** The cover's clip, as the page sets it: the polygon in page px, and what the cover is in the page's layers. */
async function coverClip(page: Page) {
  const cover = await page.evaluate(() => {
    const el = document.querySelector(".v6-cover") as HTMLElement;
    const order = [...el.parentElement!.children];
    return {
      clip: el.style.clipPath,
      art: el.querySelectorAll(".v6-art").length,
      overCanvas: order.indexOf(el) > order.indexOf(document.querySelector("canvas")!),
      underRacquet: order.indexOf(el) < order.indexOf(document.querySelector(".v6-front")!),
      pointerEvents: getComputedStyle(el).pointerEvents,
    };
  });
  const polygon = [...cover.clip.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map((m): Pt => [Number(m[1]), Number(m[2])]);
  return { ...cover, polygon };
}

/** Open the page at `size` and give back its scene, a ball's radius, and the floor a ball rests on (a touch screen's is lifted). */
async function leftEndPage(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  const L = await scene(page);
  const r = (await balls(page))[0].r;
  const lift = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? (window as any).__sandbox.params.floorLiftPx : 0));
  return { L, r, floor: L.height - lift };
}

test.describe("the bench's left end", () => {
  test("the cover repeats the bench and the towel over the canvas and under the racquet, clipped to the front left corner", async ({ page }) => {
    for (const size of LEFT_END_WINDOWS) {
      const at = `${size.width}x${size.height}`;
      const { L } = await leftEndPage(page, size);
      const cover = await coverClip(page);
      expect(cover.art, `the cover holds the bench and the towel at ${at}`).toBe(2);
      expect(cover.overCanvas && cover.underRacquet, `the cover is over the canvas and under the racquet at ${at}`).toBe(true);
      expect(cover.pointerEvents, `a press goes through it at ${at}`).toBe("none");
      expect(cover.polygon, `its clip has four corners at ${at}`).toHaveLength(4);
      expect(cover.polygon[0][0], `it starts at the bench's left end at ${at}`).toBeCloseTo(L.benchX, 0);
      expect(cover.polygon[0][1], `at its front top at ${at}`).toBeCloseTo(L.benchFrontTop, 0);
      expect(cover.polygon[1][0], `it runs forward along the top's left edge to the 150 mm point, then straight down at ${at}`).toBeGreaterThan(L.benchX);
      expect(cover.polygon[1][1]).toBeLessThan(L.benchFrontTop);
      expect(cover.polygon[2][0]).toBe(cover.polygon[1][0]);
      expect(cover.polygon[3][0]).toBeCloseTo(L.benchX, 0);
    }
  });

  // On a touch screen the floor is 30 px higher (QWW-83), which lifts a ball above the end's short face and onto its sloping top edge:
  // these two are about a mouse, on the desktop windows the design was settled on.
  test("a ball carried into the end comes off it slowly and stops beside it, not 270 px away", async ({ page }) => {
    test.skip(!!test.info().project.use.hasTouch, "the floor is lifted on a touch screen");
    test.setTimeout(120_000);
    for (const size of LEFT_END_WINDOWS) {
      const at = `${size.width}x${size.height}`;
      const { r, floor } = await leftEndPage(page, size);
      const corner = (await coverClip(page)).polygon[1][0]; // where the end face stands: 150 mm back
      const id = await sandbox<number>(page, `drop(${corner - 5 * r}, ${floor - 3 * r})`);
      await advance(page, 1.5);
      let ball = (await balls(page)).find((b) => b.id === id)!;
      await page.mouse.move(ball.x, ball.y - r * 0.3);
      await page.mouse.down();
      await carry(page, [ball.x, ball.y - r * 0.3], [corner - r * 0.4, ball.y - r * 0.3], 20);
      await page.mouse.up();
      await advance(page, 2);
      ball = (await balls(page)).find((b) => b.id === id)!;
      expect(Math.hypot(ball.vx, ball.vy), `it is at rest at ${at}`).toBeLessThan(2);
      // (it comes off the dead end at a few tens of px/s and stops within a fraction of its width of the face)
      expect(ball.x + ball.r, `it stopped beside the end face, 150 mm back, at ${at}`).toBeGreaterThan(corner - 0.8 * ball.r);
      expect(ball.x + ball.r).toBeLessThan(corner + 3);
    }
  });

  test("a ball resting against the end has about two fifths of it in view, and a press on that part takes it", async ({ page }) => {
    test.skip(!!test.info().project.use.hasTouch, "the floor is lifted on a touch screen");
    test.setTimeout(120_000);
    for (const size of LEFT_END_WINDOWS) {
      const at = `${size.width}x${size.height}`;
      const { r, floor } = await leftEndPage(page, size);
      const { polygon } = await coverClip(page);
      const corner = polygon[1][0];
      const id = await sandbox<number>(page, `drop(${corner - r - 1}, ${floor - r - 1})`);
      await advance(page, 1.5);
      const ball = (await balls(page)).find((b) => b.id === id)!;
      expect(ball.x + ball.r, `it stays against the end at ${at}`).toBeGreaterThan(corner - 3);
      expect(ball.x + ball.r).toBeLessThan(corner + 3);

      // How much of it is in view: the share of its disc that is outside the cover's clip.
      const shown = await page.evaluate(
        ({ b, polygon }) => {
          const inside = (x: number, y: number) => {
            let c = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
              const [xi, yi] = polygon[i];
              const [xj, yj] = polygon[j];
              if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
            }
            return c;
          };
          let all = 0;
          let seen = 0;
          for (let dx = -b.r; dx <= b.r; dx += b.r / 40)
            for (let dy = -b.r; dy <= b.r; dy += b.r / 40)
              if (dx * dx + dy * dy <= b.r * b.r) {
                all++;
                if (!inside(b.x + dx, b.y + dy)) seen++;
              }
          return seen / all;
        },
        { b: ball, polygon },
      );
      expect(shown, `about two fifths of the ball is in view at ${at}`).toBeGreaterThan(0.3);
      expect(shown).toBeLessThan(0.62); // (about 0.4 at 1280 x 800; a bigger scene at 844 x 390 shows a little more)

      // A press on the part in view takes it.
      await page.mouse.move(ball.x - ball.r * 0.6, ball.y);
      await page.mouse.down();
      await page.mouse.move(ball.x - ball.r * 0.6 - 30, ball.y - 40, { steps: 4 });
      const held = (await balls(page)).find((b) => b.id === id)!;
      expect(held.held, `a press on the ball's visible part takes it at ${at}`).toBe(true);
      await page.mouse.up();
    }
  });
});

test.describe("what a ball lands on", () => {
  test("a ball dropped over the bench seat comes to rest on it", async ({ page }) => {
    const L = await scene(page);
    // Just left of the bag, which is clear seat.
    const r = (await balls(page))[0].r;
    const x = L.bagAt[0] - 360 * L.k - 2.5 * r;
    const id = await sandbox<number>(page, `drop(${x}, ${L.benchSurfaceY - 6 * r})`);
    await advance(page, 8);
    const b = (await balls(page)).find((b) => b.id === id)!;
    expect(Math.hypot(b.vx, b.vy), "at rest").toBeLessThan(2);
    // The scene shows enough of the bench that its seat line is at or above the touch screen's lifted floor (QWW-85 round 3).
    expect(Math.abs(b.y + b.r - L.benchSurfaceY), "its underside on the seat's middle line").toBeLessThan(1);
  });

  test("a ball dropped over the bag does not go down through it", async ({ page }) => {
    const L = await scene(page);
    const x = L.bagAt[0] + 230 * L.k; // over the bag's highest part
    const r = (await balls(page))[0].r;
    // Run a second and a half in steps of a sixtieth, inside the page (a call from here for each step is slow).
    const lowest = await page.evaluate(
      ({ x, y, left, right }) => {
        const s = (window as any).__sandbox;
        const id = s.drop(x, y);
        let lowest = -Infinity;
        for (let i = 0; i < 90; i++) {
          s.advance(1 / 60);
          const b = s.balls().find((b: Ball) => b.id === id);
          // Over the bag's body the ball stays above the bag's top.
          if (b.x > left && b.x < right) lowest = Math.max(lowest, b.y + b.r);
        }
        return lowest;
      },
      { x, y: L.bagAt[1] - 330 * L.k - 6 * r, left: L.bagAt[0] - 290 * L.k, right: L.bagAt[0] + 350 * L.k },
    );
    expect(lowest, "the ball was over the bag").toBeGreaterThan(-Infinity);
    expect(lowest, "and its underside never went below the bag's top").toBeLessThan(L.bagAt[1] - 262 * L.k);
  });

  test("a ball dropped over a can standing in the open bag comes down on its lid and stays on it", async ({ page }) => {
    await unzip(page);
    const top = await canTop(page, 1);
    const r = (await balls(page))[0].r;
    const lowest = await page.evaluate(
      ({ x, y, reach }) => {
        const s = (window as any).__sandbox;
        const id = s.drop(x, y);
        let lowest = -Infinity;
        for (let i = 0; i < 90; i++) {
          s.advance(1 / 60);
          const b = s.balls().find((b: Ball) => b.id === id);
          // over the can (the ball, dropped a little off its middle, may be eased aside)
          if (Math.abs(b.x - x) < reach) lowest = Math.max(lowest, b.y + b.r);
        }
        return lowest;
      },
      { x: top.x, y: top.y - 1.6 * r, reach: 2 * r },
    );
    expect(lowest, "its underside came down to the lid (the can's top)").toBeGreaterThan(top.y - 12);
    expect(lowest, "and not through it").toBeLessThan(top.y + 12);
  });
});

test.describe("unzipping the bag", () => {
  test("dragging the pull along the zip to the end opens the bag, and the pull stays at the end", async ({ page }) => {
    expect(await bag(page)).toMatchObject({ zip: 0, open: false, notebookOut: false });
    await dragPull(page, 1);
    await expect.poll(async () => (await bag(page)).open).toBe(true);
    expect((await bag(page)).zip).toBe(1);
  });

  test("a click on the bag or on the pull, without moving the pull, does nothing", async ({ page }) => {
    const L = await scene(page);
    const pull = (await bag(page)).pull;
    await page.mouse.click(L.bagAt[0] + 150 * L.k, L.bagAt[1] - 100 * L.k);
    await page.mouse.click(pull[0], pull[1]);
    await page.waitForTimeout(300);
    expect(await bag(page)).toMatchObject({ zip: 0, open: false });
  });

  test("a zip let go short of the end stays where it was let go, and dragging the pull back shuts it again", async ({ page }) => {
    await dragPull(page, 0.4);
    await page.waitForTimeout(300);
    const half = await bag(page);
    expect(half.open).toBe(false);
    expect(half.zip, "left where it was let go").toBeGreaterThan(0.3);
    expect(half.zip).toBeLessThan(0.5);
    await dragPull(page, 0);
    expect((await bag(page)).zip, "dragged back to the start").toBeLessThan(0.05);
  });

  test("dragging the pull back along the zip closes an open bag, and what was in it sinks", async ({ page }) => {
    await unzip(page);
    await dragPull(page, 0);
    await expect.poll(async () => (await bag(page)).open).toBe(false);
    expect((await bag(page)).zip).toBeLessThan(0.05);
  });

  test("the pull is a slider for the keyboard: Enter runs it open and shut, the arrows move it in steps", async ({ page }) => {
    const pull = page.getByRole("slider");
    await pull.focus();
    await page.keyboard.press("ArrowRight");
    expect((await bag(page)).zip).toBeCloseTo(0.1, 5);
    await page.keyboard.press("ArrowLeft");
    expect((await bag(page)).zip).toBeCloseTo(0, 5);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await bag(page)).open).toBe(true);
    await page.keyboard.press(" ");
    await expect.poll(async () => (await bag(page)).open).toBe(false);
  });
});

test.describe("the cans", () => {
  test("a press on a can standing in the open bag takes it out, and carrying it away leaves it standing full on the floor", async ({ page }) => {
    await unzip(page);
    expect(await cans(page)).toHaveLength(0); // all three are still in the bag
    const top = await canTop(page, 0);
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    await carry(page, [top.x, top.y], [top.x - 80, top.y - 120], 8);
    const held = await cans(page);
    expect(held).toHaveLength(1);
    expect(held[0].held).toBe(true);
    // Carry it to the open floor left of the name, clear of the bench and of the letters (on a short window they fill the floor
    // between the bench and the edge), hang it a little above the floor (it is held by its top, so its foot is a can's height below
    // the pointer, and a touch screen's floor is lifted), and let it go there once it has stopped swinging.
    const L = await scene(page);
    const lift = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? (window as any).__sandbox.params.floorLiftPx : 0));
    await carry(page, [top.x - 80, top.y - 120], [100, L.height - lift - held[0].height - 10]);
    await advance(page, 1.5);
    await page.mouse.up();
    await advance(page, 4);
    const [can] = await cans(page);
    expect(can.held).toBe(false);
    expect(can.ballsLeft, "full: nothing came out of it").toBe(3);
    expect(Math.abs(can.angle), "standing upright (the angle is in radians)").toBeLessThan(0.1);
  });

  test("a can let go before it is clear of the bag drops back into its place, and can be taken again", async ({ page }) => {
    await unzip(page);
    const top = await canTop(page, 2);
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    expect(await cans(page)).toHaveLength(1);
    await page.mouse.up();
    expect(await cans(page), "back in the bag").toHaveLength(0);
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    expect(await cans(page), "and taken again").toHaveLength(1);
    await page.mouse.up();
  });

  test("a can that is shaken hard by its base is turned over and pours its balls out", async ({ page }) => {
    test.slow(); // a long run of small moves, each one a round trip to the page: three times the time on a slow machine
    await freeze(page);
    await unzip(page);
    const top = await canTop(page, 0);
    const L = await scene(page);
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    await carry(page, [top.x, top.y], [top.x - 40, top.y - 60], 6);
    const height = (await cans(page))[0].height;
    // Set it down on the open floor left of the name, as a visitor would, and let it settle: it stands, full.
    const lift = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? (window as any).__sandbox.params.floorLiftPx : 0));
    await carry(page, [top.x - 40, top.y - 60], [100, L.height - lift - height - 10]);
    // The can swings under the hand for a while after the hand stops, and a can let go in mid-swing may land on its side. It is let go once
    // the swing is over, and this waits for that in the court's time and not the machine's.
    await until(page, async () => (await cans(page))[0], (c) => Math.hypot(c.vx, c.vy) < 30 && Math.abs(c.angle) < 0.05, "the can hangs still in the hand", 8);
    await page.mouse.up();
    await advance(page, 3);
    const [can] = await cans(page);
    expect(can.ballsLeft).toBe(3);
    expect(Math.abs(can.angle), "it stands upright (the angle is in radians)").toBeLessThan(0.1);
    // Take it by its base, lift it, and shake it from side to side, as hard as a hand does: the hand's grip keeps a can upright through
    // a gentle carry, not through this. Each swing is paced in small moves, a frame apart.
    const before = (await balls(page)).length;
    const base: Pt = [can.x, can.y + can.height * 0.4];
    await page.mouse.move(base[0], base[1]);
    await page.mouse.down();
    const lifted: Pt = [base[0] + can.height * 1.5, base[1] - can.height * 1.5]; // clear of the wall, which would stop half of each swing
    await carry(page, base, lifted, 15);
    let at = lifted;
    for (let swing = 0; swing < 10 && (await cans(page))[0].ballsLeft > 0; swing++) {
      for (const to of [[lifted[0] + can.height * 0.5, lifted[1]], [lifted[0] - can.height * 0.5, lifted[1]]] as Pt[]) {
        await carry(page, at, to, 6);
        at = to;
      }
    }
    await page.mouse.up();
    await advance(page, 3);
    const [after] = await cans(page);
    expect(after.ballsLeft, "emptied").toBe(0);
    expect((await balls(page)).length, "its three balls are on the court").toBeGreaterThanOrEqual(before + 3);
  });
});

test.describe("the notebook", () => {
  test("a click on it in the open bag opens it over the toy, with its words, and Escape sends it back", async ({ page }) => {
    await unzip(page);
    await openNotebook(page);
    await expect(notebookDialog(page)).toBeVisible();
    await expect.poll(async () => (await bag(page)).notebookOut).toBe(true);
    // Its words: the same text the unit test pins (src/notebook-text.test.ts), as one text, in order.
    const words = await notebookDialog(page).locator(".v6-nb-text").textContent();
    expect(words?.replace(/\s+/g, " ").trim()).toBe(notebookText().replace(/\s+/g, " ").trim());
    await page.keyboard.press("Escape");
    await expect(notebookDialog(page)).toBeHidden();
    await expect.poll(async () => (await bag(page)).notebookOut).toBe(false);
  });

  test("its close chip and a click on the dimmed toy around it also close it", async ({ page }) => {
    await unzip(page);
    await openNotebook(page);
    await expect(notebookDialog(page)).toBeVisible();
    await notebookDialog(page).getByRole("button", { name: "Close the notebook" }).click();
    await expect(notebookDialog(page)).toBeHidden();
    await expect.poll(async () => (await bag(page)).notebookOut).toBe(false);
    await openNotebook(page);
    await expect(notebookDialog(page)).toBeVisible();
    // It has finished opening: nothing in it is still animating. (A wait of a fixed time ends before that on a slow machine.)
    await expect.poll(() => notebookDialog(page).evaluate((el) => el.getAnimations({ subtree: true }).some((a) => a.playState === "running"))).toBe(false);
    await page.waitForTimeout(100);
    await page.mouse.click(3, 3); // the corner of the window, outside the spread (which keeps 8 px clear of the edge in a short window)
    await expect(notebookDialog(page)).toBeHidden();
  });

  /** Open the notebook at `size` (a fresh page) and give back what it reports of itself. */
  async function notebookAt(page: Page, size: { width: number; height: number }) {
    await page.setViewportSize(size);
    await page.goto("./");
    await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
    await unzip(page);
    await openNotebook(page);
    await expect(notebookDialog(page), `the notebook opens at ${size.width}x${size.height}`).toBeVisible();
    await page.waitForTimeout(1200);
    // (Caveat is fetched when the notebook first opens, and the words are measured again when it arrives: wait for that on a slow machine)
    await expect.poll(async () => (await sandbox<{ fits: boolean; ball: boolean }>(page, "notebook()")).fits, { timeout: 10_000 }).toBe(true);
    return sandbox<{ px: number; fits: boolean; paged: boolean; spread: number; ball: boolean; width: number }>(page, "notebook()");
  }

  test("its type is 14 px or more, with every line on a page and the ball showing, in every window", async ({ page }) => {
    test.setTimeout(120_000); // six windows, each with an unzip and a notebook
    for (const size of WINDOWS) {
      const type = await notebookAt(page, size);
      const at = `${size.width}x${size.height}`;
      expect(type.px, `type size at ${at}`).toBeGreaterThanOrEqual(14);
      expect(type.fits, `every line on a page at ${at}`).toBe(true);
      expect(type.ball, `the ball shows at ${at}`).toBe(true);
      expect(type.paged, `two spreads only in a window under 340 px tall, at ${at}`).toBe(size.height < 340);
    }
  });

  test("the note is signed '- Quinn Wai', on the ball's line and to its right", async ({ page }) => {
    await notebookAt(page, { width: 1440, height: 800 });
    const sign = notebookDialog(page).locator(".v6-nb-doodle .v6-nb-sign");
    await expect(sign).toHaveText("- Quinn Wai");
    const s = (await sign.boundingBox())!;
    const ball = (await notebookDialog(page).locator(".v6-nb-doodle > g").boundingBox())!;
    expect(s.x, "after the ball").toBeGreaterThan(ball.x + ball.width);
    expect(Math.abs(s.y + s.height / 2 - (ball.y + ball.height / 2)), "on the ball's line").toBeLessThan(ball.height);
  });

  test("in a window 390 px tall the notebook is one spread, no more than 75 percent of the window's width", async ({ page }) => {
    const type = await notebookAt(page, { width: 844, height: 390 });
    expect(type.paged).toBe(false);
    expect(type.px).toBe(14);
    expect(type.width / 844).toBeLessThanOrEqual(0.75);
  });

  test("in a window 280 px tall it turns to a second spread at 14 px, with the ball on the last page, and Escape still closes it", async ({ page }) => {
    const type = await notebookAt(page, { width: 750, height: 280 });
    expect(type.paged).toBe(true);
    expect(type.px).toBe(14);
    expect(type.fits).toBe(true);
    expect(type.width / 750, "about two thirds of the window's width").toBeLessThan(0.7);
    const turn = notebookDialog(page).getByRole("button", { name: /Turn to the next page/ });
    await expect(turn).toBeVisible();
    const ball = notebookDialog(page).locator(".v6-nb-doodle");
    await expect(ball, "the ball is on the last page, not the first spread").toBeHidden();
    // the chip turns it (a finger and the mouse both click it)
    await turn.click();
    expect((await sandbox<{ spread: number }>(page, "notebook()")).spread).toBe(1);
    await expect(ball).toBeVisible();
    const back = notebookDialog(page).getByRole("button", { name: /Turn back/ });
    await back.click();
    expect((await sandbox<{ spread: number }>(page, "notebook()")).spread).toBe(0);
    // so do the arrow keys
    await page.keyboard.press("ArrowRight");
    expect((await sandbox<{ spread: number }>(page, "notebook()")).spread).toBe(1);
    await page.keyboard.press("ArrowLeft");
    expect((await sandbox<{ spread: number }>(page, "notebook()")).spread).toBe(0);
    // the words of the second spread are the ones that were cut off the first: the last words are on it
    await page.keyboard.press("ArrowRight");
    const lastPage = await notebookDialog(page).locator(".v6-nb-text").evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const outer = el.getBoundingClientRect();
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5);
      return { shown: rects.some((r) => r.left >= outer.left - 1 && r.right <= outer.right + 1), count: rects.length };
    });
    expect(lastPage.shown, "words are on the turned spread").toBe(true);
    await page.keyboard.press("Escape");
    await expect(notebookDialog(page)).toBeHidden();
  });

  test("a window that holds the words on one spread has no turn chip", async ({ page }) => {
    await notebookAt(page, { width: 1280, height: 800 });
    await expect(notebookDialog(page).getByRole("button", { name: /Turn/ })).toBeHidden();
  });

  test("it is credited in the credits", async ({ page }) => {
    await page.getByRole("button", { name: "Credits", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Credits" })).toContainText("the notebook: Carmen Sandiego's Great Chase Through Time");
  });
});

test.describe("starting again", () => {
  test("Clear takes the cans back into the bag, full, and zips it shut with the notebook inside", async ({ page }) => {
    await unzip(page);
    const top = await canTop(page, 0);
    const L = await scene(page);
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    await page.mouse.move(Math.max(60, L.benchX - 70), L.height - 200, { steps: 20 });
    await page.mouse.up();
    await advance(page, 2);
    expect(await cans(page)).toHaveLength(1);
    await page.getByRole("button", { name: "Clear the balls" }).click();
    expect(await cans(page)).toHaveLength(0);
    await expect.poll(async () => (await bag(page)).open).toBe(false);
    await expect.poll(async () => (await bag(page)).zip).toBeLessThan(0.02);
    // Unzipped again, all three cans are there to take, full.
    await unzip(page);
    for (let n = 0; n < 3; n++) {
      const t = await canTop(page, n);
      await page.mouse.move(t.x, t.y);
      await page.mouse.down();
      await page.mouse.up();
    }
    expect(await cans(page), "all three are still in the bag, and a press and release puts each back").toHaveLength(0);
  });

  test("with the notebook open, Clear closes it too", async ({ page }) => {
    await unzip(page);
    await openNotebook(page);
    await expect(notebookDialog(page)).toBeVisible();
    await page.evaluate(() => document.querySelector<HTMLButtonElement>(".chip.clear")!.click());
    await expect(notebookDialog(page)).toBeHidden();
    expect((await bag(page)).open).toBe(false);
  });
});

test.describe("the test hook", () => {
  test("has the shapes the other skins and the tests rely on", async ({ page }) => {
    const shape = await page.evaluate(() => {
      const s = (window as any).__sandbox;
      return { bag: Object.keys(s.bag()).sort(), notebook: Object.keys(s.notebook()).sort(), cans: Array.isArray(s.cans()), advance: typeof s.advance, balls: Array.isArray(s.balls()), effects: Object.keys(s.effects()).sort() };
    });
    expect(shape).toEqual({
      bag: ["notebookOut", "open", "pull", "zip"],
      notebook: ["ball", "fits", "open", "paged", "px", "spread", "width"],
      cans: true,
      advance: "function",
      balls: true,
      effects: ["bursts", "trailPoints"],
    });
  });
});
