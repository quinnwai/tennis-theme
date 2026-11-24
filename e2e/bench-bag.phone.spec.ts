// The bag, the notebook and the cans with a finger: the same things as e2e/bench-bag.spec.ts, on the phones held sideways, with real touch
// input and no mouse. The file's name ends in phone.spec.ts, so that playwright.config.ts runs it on the phone projects only (the sideways
// ones, by the title below) and not on the desktop one.

import { expect, type CDPSession, type Page } from "@playwright/test";
import { test } from "./test";

interface Point {
  x: number;
  y: number;
}

type Pt = [number, number];

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const bag = (page: Page) => sandbox<{ zip: number; open: boolean; notebookOut: boolean; pull: Pt }>(page, "bag()");
const cans = (page: Page) => sandbox<{ held: boolean; ballsLeft: number; height: number }[]>(page, "cans()");
const notebookDialog = (page: Page) => page.getByRole("dialog", { name: "Notebook" });

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
});

/**
 * Fingers on the screen, sent through the browser's own touch input (the Chrome DevTools protocol), as in e2e/phone.spec.ts, from which this
 * is copied (a file of its own, so that the two stay apart). A press or a move names every finger that is down; a lift names only the
 * finger that lifts. Fingers are numbered by the caller, from 1.
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

/** Where the part of item `i` of the bag that shows is, as the page draws it (the cans are 0 to 2, the notebook 3). */
const itemBox = (page: Page, i: number) =>
  page.evaluate((i) => {
    const r = document.querySelectorAll(".v6-rise")[i].getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width };
  }, i);

/** Unzip the bag with a finger on its pull, and give what is in it the time to come up. */
async function unzip(page: Page, fingers: Fingers) {
  const from = (await bag(page)).pull;
  const end = await sandbox<Pt>(page, "zipPoint(1)");
  await fingers.press(1, { x: from[0], y: from[1] });
  await fingers.move(1, { x: end[0], y: end[1] }, 14);
  await fingers.lift(1);
  await expect.poll(async () => (await bag(page)).open).toBe(true);
  await page.waitForTimeout(1000);
}

test.describe("a phone held sideways", () => {
  test("a finger on the pull drags the zip to the end and opens the bag", async ({ page }) => {
    const fingers = await Fingers.on(page);
    await unzip(page, fingers);
    expect((await bag(page)).zip).toBe(1);
  });

  test("a finger on the bag, without moving the pull, does nothing", async ({ page }) => {
    const fingers = await Fingers.on(page);
    const pull = (await bag(page)).pull;
    await fingers.press(1, { x: pull[0], y: pull[1] });
    await fingers.lift(1);
    await page.waitForTimeout(300);
    expect(await bag(page)).toMatchObject({ zip: 0, open: false });
  });

  test("a finger takes a can out of the open bag and carries it; letting go before it is clear puts it back", async ({ page }) => {
    const fingers = await Fingers.on(page);
    await unzip(page, fingers);
    const box = await itemBox(page, 1);
    const top = { x: box.left + box.width / 2, y: box.top + 8 };
    await fingers.press(1, top);
    await expect.poll(async () => (await cans(page)).length).toBe(1);
    await fingers.lift(1);
    expect(await cans(page), "let go in the bag: back in it").toHaveLength(0);

    await fingers.press(1, top);
    await expect.poll(async () => (await cans(page)).length).toBe(1);
    await fingers.move(1, { x: top.x - 60, y: top.y - 60 }, 8);
    expect((await cans(page))[0].held, "carried by the finger").toBe(true);
    await fingers.lift(1);
  });

  test("a finger on the notebook opens it, and the close chip sends it back", async ({ page }) => {
    const fingers = await Fingers.on(page);
    await unzip(page, fingers);
    const box = (await page.getByRole("button", { name: "Open the notebook" }).boundingBox())!;
    await fingers.press(1, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await fingers.lift(1);
    await expect(notebookDialog(page)).toBeVisible();
    await page.waitForTimeout(900);
    await notebookDialog(page).getByRole("button", { name: "Close the notebook" }).tap();
    await expect(notebookDialog(page)).toBeHidden();
    expect((await bag(page)).notebookOut).toBe(false);
  });
});
