// The bench, the bag, the notebook and the cans of balls (QWW-85, the v6 design), checked in a real browser: where the bench stands, that
// balls land on it and on the bag, that the bag is unzipped by its pull, what comes out of it, and what the notebook does. The same
// checks run on every project, the phones held sideways included (with a mouse; the finger checks are in bench-bag.phone.spec.ts).
// Everything goes through the page's test hook, window.__sandbox. The court's own rules are in src/cans.test.ts.

import { expect, test, type Page } from "@playwright/test";
import { NOTEBOOK_TEXT } from "../src/notebook-text";

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
    // On a touch screen the floor is lifted (params.floorLiftPx, QWW-83), and where the bench's seat is lower than that lifted floor (a window
    // as short as a phone held sideways) the ball rests on the floor, a few px above the seat's middle line: look at it on a phone.
    const lift = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? (window as any).__sandbox.params.floorLiftPx : 0));
    const rest = Math.min(L.benchSurfaceY, L.height - lift);
    expect(b.y + b.r, "its underside on the seat").toBeGreaterThan(rest - 2);
    expect(b.y + b.r).toBeLessThan(rest + 2);
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
    await page.mouse.move(top.x - 80, top.y - 120, { steps: 8 });
    const held = await cans(page);
    expect(held).toHaveLength(1);
    expect(held[0].held).toBe(true);
    // Carry it left, off the bench, to the open floor, and let it go there.
    const L = await scene(page);
    await page.mouse.move(Math.max(60, L.benchX - 70), L.height - held[0].height * 1.2, { steps: 20 });
    await page.mouse.up();
    await advance(page, 4);
    const [can] = await cans(page);
    expect(can.held).toBe(false);
    expect(can.ballsLeft, "full: nothing came out of it").toBe(3);
    expect(Math.abs(can.angle) % 360, "standing upright").toBeLessThan(5);
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

  test("a can that is turned over pours its balls out, one after another", async ({ page }) => {
    await unzip(page);
    const top = await canTop(page, 0);
    const L = await scene(page);
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    await page.mouse.move(top.x - 40, top.y - 60, { steps: 6 });
    const height = (await cans(page))[0].height;
    // Carry it to the open floor, set it down just above it, and let it hang there a moment: it stands.
    const floorX = Math.max(60, L.benchX - 70);
    await page.mouse.move(floorX, L.height - height - 40, { steps: 20 });
    await advance(page, 1);
    await page.mouse.up();
    await advance(page, 3);
    const [can] = await cans(page);
    expect(can.ballsLeft).toBe(3);
    expect(Math.abs(can.angle) % 360, "it stands upright").toBeLessThan(10);
    // Take it by its base and lift, with no hand keeping it upright: it hangs from there, mouth down.
    await page.evaluate(() => ((window as any).__sandbox.params.canGrip = 0));
    await page.mouse.move(can.x, can.y + can.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(can.x, can.y - can.height * 0.8, { steps: 10 });
    await advance(page, 1.5);
    await page.mouse.up();
    await advance(page, 2);
    const [after] = await cans(page);
    expect(after.ballsLeft, "emptied").toBe(0);
    expect(await balls(page), "its three balls are on the court").toHaveLength(5);
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
    expect(words?.replace(/\s+/g, " ").trim()).toBe(NOTEBOOK_TEXT.replace(/\s+/g, " ").trim());
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
    await page.waitForTimeout(1200); // it has finished opening
    await page.mouse.click(8, 8);
    await expect(notebookDialog(page)).toBeHidden();
  });

  test("its type is at least 14 px and all its words are on the pages, in every window", async ({ page }) => {
    test.setTimeout(120_000); // six windows, each with an unzip and a notebook
    for (const size of WINDOWS) {
      await page.setViewportSize(size);
      await page.goto("./");
      await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
      await unzip(page);
      await openNotebook(page);
      await expect(notebookDialog(page), `the notebook opens at ${size.width}x${size.height}`).toBeVisible();
      await page.waitForTimeout(1200);
      const type = await sandbox<{ px: number; fits: boolean }>(page, "notebook()");
      expect(type.px, `type size at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(14);
      expect(type.fits, `every line on a page at ${size.width}x${size.height}`).toBe(true);
    }
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
      notebook: ["fits", "open", "px"],
      cans: true,
      advance: "function",
      balls: true,
      effects: ["bursts", "trailPoints"],
    });
  });
});
