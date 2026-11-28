// QWW-116: the notebook's ball and its sign-off, "- Quinn Wai", sit together after the last words without covering any of them, and the last
// spread shows the last page of words, at every window size, after resizing, and so after a phone is turned and Safari's toolbar shows or hides.
// (Before: at heights where a page holds 15 rules, about 330 to 339 px, the words end on page 3, the ball goes to page 4, but the words have
// only three columns, so the browser stops turning short and the second spread shows pages 2 and 3, with the ball over the words of page 3.)

import { expect, type Page } from "@playwright/test";
import { test } from "./test";

type Pt = [number, number];
const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const notebookDialog = (page: Page) => page.getByRole("dialog", { name: "Notebook" });
const notebookState = (page: Page) => sandbox<{ px: number; fits: boolean; paged: boolean; spread: number; ball: boolean; width: number }>(page, "notebook()");

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
});

/** Unzip the bag by its pull, and give what is in it the time to come up (as in e2e/bench-bag.spec.ts). */
async function unzip(page: Page) {
  const from = (await sandbox<{ pull: Pt }>(page, "bag()")).pull;
  const end = await sandbox<Pt>(page, "zipPoint(1)");
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(end[0], end[1], { steps: 14 });
  await page.mouse.up();
  await expect.poll(async () => (await sandbox<{ open: boolean }>(page, "bag()")).open).toBe(true);
  await page.waitForTimeout(1000);
}

/** Open the notebook at `size` (a fresh page), once its words are set. */
async function openAt(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  await unzip(page);
  await page.getByRole("button", { name: "Open the notebook" }).click();
  await expect(notebookDialog(page)).toBeVisible();
  await page.waitForTimeout(1200);
  await expect.poll(async () => (await notebookState(page)).fits, { timeout: 10_000 }).toBe(true);
}

/** Turn to the last spread (the arrow keys; they do nothing when there is one spread), and give the turn a moment. */
async function toLastSpread(page: Page) {
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
}

/**
 * What the last spread shows, in screen px: every line of words that is on the spread's pages, the ball, the sign-off, and the last line of
 * all the words (with whether it is on the spread).
 */
async function lastSpread(page: Page) {
  return notebookDialog(page).evaluate((dialog) => {
    const text = dialog.querySelector<HTMLElement>(".v6-nb-text")!;
    const outer = text.getBoundingClientRect();
    const lines: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) if (r.width > 0.5) lines.push({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom });
    }
    const shown = (l: { x0: number; x1: number }) => l.x0 >= outer.left - 1 && l.x1 <= outer.right + 1;
    const box = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r && r.width > 0 ? { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom } : null;
    };
    const doodle = dialog.querySelector<SVGGElement>(".v6-nb-doodle")!;
    const visible = getComputedStyle(doodle).display !== "none";
    const lastLine = lines[lines.length - 1]; // the text nodes and their lines are in reading order
    return {
      visibleLines: lines.filter(shown),
      lastLine,
      lastShown: shown(lastLine),
      ball: visible ? box(doodle.querySelector(":scope > g")) : null,
      sign: visible ? box(doodle.querySelector(".v6-nb-sign")) : null,
    };
  });
}

type Box = { x0: number; x1: number; y0: number; y1: number };
const overlap = (a: Box, b: Box) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;

/** The checks of the last spread, for a window of `at`. */
async function expectSignedAfterTheWords(page: Page, at: string) {
  const type = await notebookState(page);
  await toLastSpread(page);
  const s = await lastSpread(page);
  expect(s.lastShown, `the last words are on the last spread at ${at}`).toBe(true);
  expect(s.ball, `the ball shows on the last spread at ${at}`).not.toBeNull();
  expect(s.sign, `the sign-off shows on the last spread at ${at}`).not.toBeNull();
  for (const line of s.visibleLines) {
    expect(overlap(line, s.ball!), `the ball covers no words at ${at}`).toBe(false);
    expect(overlap(line, s.sign!), `the sign-off covers no words at ${at}`).toBe(false);
  }
  const mid = (s.ball!.y0 + s.ball!.y1) / 2;
  expect(s.sign!.x0, `the sign-off is to the right of the ball at ${at}`).toBeGreaterThanOrEqual(s.ball!.x1 - 0.5);
  expect(s.sign!.y0 - 1 <= mid && mid <= s.sign!.y1 + 1, `the sign-off is on the ball's line at ${at}`).toBe(true);
  // after the last words: under them on the page they end on, or on the page after it
  const below = s.ball!.y0 >= s.lastLine.y1 - 0.5 || s.ball!.x0 >= s.lastLine.x1 - 0.5;
  expect(below, `the ball comes after the last words at ${at}`).toBe(true);
  expect(type.fits, `every line is on a page at ${at}`).toBe(true);
}

const SIZES = [
  { width: 750, height: 280 },
  { width: 750, height: 300 },
  { width: 750, height: 320 },
  { width: 750, height: 335 },
  { width: 750, height: 339 },
  { width: 852, height: 282 },
  { width: 852, height: 320 },
];

test.describe("the notebook's signature ball", () => {
  for (const size of SIZES) {
    test(`at ${size.width}x${size.height} the ball and the sign-off come after the last words, covering none, on the last spread (QWW-116)`, async ({ page }) => {
      await openAt(page, size);
      await expectSignedAfterTheWords(page, `${size.width}x${size.height}`);
    });
  }

  test("resized while open, 280 to 335 px tall and back, the ball and the sign-off stay after the last words at every step (QWW-116)", async ({ page }) => {
    test.setTimeout(120_000);
    await openAt(page, { width: 750, height: 280 });
    const heights = [280, 290, 300, 310, 320, 326, 330, 333, 335, 330, 320, 300, 280];
    for (const height of heights) {
      await page.setViewportSize({ width: 750, height });
      await page.waitForTimeout(400);
      await expect.poll(async () => (await notebookState(page)).fits, { timeout: 10_000 }).toBe(true);
      await expectSignedAfterTheWords(page, `750x${height} after a resize`);
      // turned back to the first spread, as a person would, before the next resize
      await page.keyboard.press("ArrowLeft");
    }
  });
});
