// The bag, the notebook and the cans with a finger: the same things as e2e/bench-bag.spec.ts, on the phones held sideways, with real touch
// input and no mouse. The file's name ends in phone.spec.ts, so that playwright.config.ts runs it on the phone projects only (the sideways
// ones, by the title below) and not on the desktop one.

import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { params } from "../src/params";

interface Point {
  x: number;
  y: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Can {
  id: number;
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

interface Scenery {
  seat: Box;
  bag: Box;
  zip: { x0: number; x1: number; y: number };
  pull: Point;
  notebook: Box;
  spots: Point[];
}

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const cans = (page: Page) => sandbox<Can[]>(page, "cans()");
const scenery = (page: Page) => sandbox<Scenery>(page, "scenery()");
const bagState = (page: Page) => sandbox<{ open: boolean; pull: number }>(page, "bag()");
const notebookState = (page: Page) => sandbox<{ out: boolean; open: boolean }>(page, "notebook()");
const advance = (page: Page, seconds: number) => sandbox<void>(page, `advance(${seconds})`);
const lastHit = (page: Page) => sandbox<unknown>(page, "lastHit()");
const notebookButton = (page: Page) => page.getByRole("button", { name: "Notebook" });
const notebookPage = (page: Page) => page.getByRole("dialog", { name: "Notebook" });

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
});

/**
 * Fingers on the screen, sent through the browser's own touch input (the Chrome DevTools protocol), as in e2e/phone.spec.ts, from which this
 * is copied (a file of its own, so that the two stay apart while that one is still changing). A press or a move names every finger that is
 * down; a lift names only the finger that lifts. Fingers are numbered by the caller, from 1.
 */
class Fingers {
  private down = new Map<number, Point>();

  private constructor(private cdp: CDPSession) {}

  static async on(page: Page) {
    return new Fingers(await page.context().newCDPSession(page));
  }

  private send(type: "touchStart" | "touchMove" | "touchEnd", fingers: [number, Point][]) {
    return this.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: fingers.map(([id, p]) => ({ id, x: p.x, y: p.y })) });
  }

  async press(finger: number, at: Point) {
    this.down.set(finger, at);
    await this.send("touchStart", [...this.down]);
  }

  /** Move a finger that is down to `to`, in `steps` equal steps. */
  async move(finger: number, to: Point, steps = 1) {
    const from = this.down.get(finger)!;
    for (let i = 1; i <= steps; i++) {
      this.down.set(finger, { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
      await this.send("touchMove", [...this.down]);
    }
  }

  async lift(finger: number) {
    await this.send("touchEnd", [[finger, this.down.get(finger)!]]);
    this.down.delete(finger);
  }
}

/** Open the bag with a finger on the pull, and give the notebook and the cans the time to come out. */
async function unzipWithAFinger(page: Page, fingers: Fingers) {
  const s = await scenery(page);
  await fingers.press(1, s.pull);
  await fingers.move(1, { x: s.zip.x1 + 8, y: s.pull.y }, 12);
  await fingers.lift(1);
  await expect.poll(async () => (await bagState(page)).open).toBe(true);
  await advance(page, 2);
}

test.describe("a phone held sideways, with a finger", () => {
  test("a finger dragging the zip's pull along the bag opens it, and the notebook and three cans come out", async ({ page }) => {
    const fingers = await Fingers.on(page);
    expect(await bagState(page)).toEqual({ open: false, pull: 0 });
    await unzipWithAFinger(page, fingers);
    expect(await bagState(page)).toEqual({ open: true, pull: 1 });
    expect(await notebookState(page)).toEqual({ out: true, open: false });
    const out = await cans(page);
    expect(out).toHaveLength(3);
    for (const can of out) expect(can.ballsLeft).toBe(3);
    await expect(notebookButton(page)).toBeVisible();
  });

  test("the notebook is at least 44 by 44 px to tap, even where only a few cm of it stand out of the bag", async ({ page }) => {
    const fingers = await Fingers.on(page);
    await unzipWithAFinger(page, fingers);
    const box = (await notebookButton(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44 - 0.05);
    // It starts where the notebook shows, and what it takes beyond that is from the top of the bag below.
    const s = await scenery(page);
    expect(box.y).toBeCloseTo(s.notebook.top, 0);
    expect(box.y + box.height).toBeLessThanOrEqual(s.bag.top + 44);
    // A tap low in it, on the bag's top just under the notebook, opens it, the notebook being what is there.
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 3);
    await expect(notebookPage(page)).toBeVisible();
  });

  test("a tap with a finger on the bag, or on the pull, does not open it", async ({ page }) => {
    const s = await scenery(page);
    await page.touchscreen.tap((s.bag.left + s.bag.right) / 2, (s.bag.top + s.bag.bottom) / 2 + 8);
    await page.touchscreen.tap(s.pull.x, s.pull.y);
    await page.touchscreen.tap(s.bag.right - 15, s.bag.top + 15);
    expect(await bagState(page)).toEqual({ open: false, pull: 0 });
    await advance(page, 2);
    expect(await cans(page)).toEqual([]);
    expect(await lastHit(page), "a tap on the bag is not a hit on anything").toBeNull();
  });

  test("the pull is taken from a finger's width away, which it is too small to be taken by otherwise, and not from well outside that", async ({ page }) => {
    const fingers = await Fingers.on(page);
    const s = await scenery(page);
    const reach = params.touchMinHitReachPx;
    // Well outside: a finger there drags nothing.
    await fingers.press(1, { x: s.pull.x, y: s.pull.y + reach + 14 });
    await fingers.move(1, { x: s.zip.x1, y: s.pull.y + reach + 14 }, 8);
    await fingers.lift(1);
    expect((await bagState(page)).pull).toBe(0);
    // Just inside it: the pull comes along, without jumping to the finger (it keeps its place under it).
    await fingers.press(1, { x: s.pull.x, y: s.pull.y + reach - 4 });
    await fingers.move(1, { x: s.pull.x + 60, y: s.pull.y + reach - 4 }, 6);
    // The page handles touch moves a moment after they are sent, so it is waited for to arrive: 60 px along, as far as the finger has gone.
    await expect.poll(async () => (await bagState(page)).pull).toBeCloseTo(60 / (s.zip.x1 - s.zip.x0), 2);
    await fingers.lift(1);
  });

  test("a second finger on the screen does not take the pull from the first, or let go of it", async ({ page }) => {
    const fingers = await Fingers.on(page);
    const s = await scenery(page);
    await fingers.press(1, s.pull);
    await fingers.move(1, { x: s.zip.x0 + (s.zip.x1 - s.zip.x0) * 0.3, y: s.pull.y }, 6);
    await expect.poll(async () => (await bagState(page)).pull).toBeCloseTo(0.3, 2);
    const before = (await bagState(page)).pull;
    await fingers.press(2, { x: 40, y: 150 }); // elsewhere, on empty screen
    await fingers.move(2, { x: 80, y: 160 }, 4);
    expect((await bagState(page)).pull, "the second finger moved nothing").toBeCloseTo(before, 5);
    await fingers.lift(2);
    expect(await bagState(page), "and lifting it did not end the first finger's drag").toMatchObject({ open: false });
    await fingers.move(1, { x: s.zip.x1 + 8, y: s.pull.y }, 8);
    await fingers.lift(1);
    expect((await bagState(page)).open).toBe(true);
  });

  test("a tap with a finger on the notebook opens its page, and the words fit on it; a tap outside it, and the close control, close it", async ({ page }) => {
    const fingers = await Fingers.on(page);
    await unzipWithAFinger(page, fingers);
    await notebookButton(page).tap();
    await expect(notebookPage(page)).toBeVisible();
    await expect(notebookPage(page).getByText("You found the secret message!")).toBeVisible();
    const fit = await page.evaluate(() => {
      const sheet = document.querySelector<HTMLElement>(".notebook-page")!;
      const box = sheet.getBoundingClientRect();
      return { scrolls: sheet.scrollHeight > sheet.clientHeight + 1, inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight };
    });
    expect(fit).toEqual({ scrolls: false, inside: true });

    // A tap outside the page closes it...
    await page.touchscreen.tap(4, page.viewportSize()!.height - 4);
    await expect(notebookPage(page)).toBeHidden();
    // ...and so does the close control.
    await notebookButton(page).tap();
    await expect(notebookPage(page)).toBeVisible();
    await notebookPage(page).getByRole("button", { name: "Close" }).tap();
    await expect(notebookPage(page)).toBeHidden();
    expect(await notebookState(page)).toEqual({ out: true, open: false });
  });

  test("a finger picks a can up and carries it, and lifting while it moves throws it the way it was going", async ({ page }) => {
    const fingers = await Fingers.on(page);
    await unzipWithAFinger(page, fingers);
    const [, , far] = await cans(page); // the one furthest from the bag, with room to its left
    const grab = { x: far.x, y: far.y - far.height * 0.2 };

    // Carried: it follows the finger, hanging from where it was taken, upright, and keeps its balls.
    const to = { x: far.x - 40, y: grab.y - far.height * 0.3 };
    await fingers.press(1, grab);
    await fingers.move(1, to, 10);
    await expect.poll(async () => (await cans(page)).find((c) => c.id === far.id)!.held).toBe(true);
    await expect
      .poll(async () => {
        const c = (await cans(page)).find((k) => k.id === far.id)!;
        return Math.hypot(c.x - (to.x - (grab.x - far.x)), c.y - (to.y - (grab.y - far.y)));
      })
      .toBeLessThan(far.height * 0.2);
    const held = (await cans(page)).find((c) => c.id === far.id)!;
    expect(Math.abs(held.angle)).toBeLessThan(0.6);
    expect(held.ballsLeft).toBe(3);
    await fingers.lift(1);
    await expect.poll(async () => (await cans(page)).find((c) => c.id === far.id)!.held).toBe(false);

    // Thrown: pressed again, taken a long way off to the left so that it is still chasing, fast, and lifted while it is.
    await advance(page, 2);
    const again = (await cans(page)).find((c) => c.id === far.id)!;
    await page.evaluate(() => ((window as any).__sandbox.params.carrySpeed = 3)); // slower, so that the can is clearly moving for a good while
    await fingers.press(1, { x: again.x, y: again.y - again.height * 0.2 });
    await fingers.move(1, { x: again.x - 20, y: again.y - again.height * 0.2 - 15 }, 3);
    await fingers.move(1, { x: 8, y: again.y - again.height * 0.2 - 30 }, 4);
    await expect
      .poll(async () => {
        const c = (await cans(page)).find((k) => k.id === far.id)!;
        return Math.hypot(c.vx, c.vy);
      }, { intervals: [5, 10, 20] })
      .toBeGreaterThan(250);
    await fingers.lift(1);
    const thrown = (await cans(page)).find((c) => c.id === far.id)!;
    expect(thrown.held).toBe(false);
    expect(thrown.vx, "it keeps going to the left").toBeLessThan(-150);
  });

  test("a second finger neither steers nor drops a can that the first is carrying", async ({ page }) => {
    const fingers = await Fingers.on(page);
    await unzipWithAFinger(page, fingers);
    const [, , far] = await cans(page);
    const grab = { x: far.x, y: far.y - far.height * 0.2 };
    const holding = { x: grab.x - 30, y: grab.y - far.height * 0.3 };
    await fingers.press(1, grab);
    await fingers.move(1, holding, 8);
    await expect.poll(async () => (await cans(page)).find((c) => c.id === far.id)!.held).toBe(true);
    await advance(page, 0.5);
    const settled = (await cans(page)).find((c) => c.id === far.id)!;

    // A second finger comes down far away, wanders, and lifts. The can stays where the first finger has it.
    const { width, height } = page.viewportSize()!;
    await fingers.press(2, { x: width / 2, y: height - 25 });
    await fingers.move(2, { x: width / 2 + 60, y: height - 40 }, 4);
    await advance(page, 0.5);
    await fingers.lift(2);
    await advance(page, 0.2);
    const after = (await cans(page)).find((c) => c.id === far.id)!;
    expect(after.held, "still in the first finger's hand").toBe(true);
    expect(Math.hypot(after.x - settled.x, after.y - settled.y)).toBeLessThan(far.height * 0.12);
    await fingers.lift(1);
  });
});
