// The bench, the tennis bag, the notebook and the cans, checked in a real browser: the page's own code runs, and the mouse does what a
// visitor would. The same checks run on the phones held sideways (their browsers have a touch screen, and the mouse still works there);
// what only a finger can show is in e2e/bench-bag.phone.spec.ts. Against the dev server or, with BASE_URL set, a deployed copy.

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

/** One can as the page's test hook reports it: its middle, its size, how it is turned (radians, clockwise) and the balls it still holds. */
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

/** Where the furniture stands, as the page reports it. */
interface Scenery {
  seat: Box;
  legs: Box[];
  bag: Box;
  zip: { x0: number; x1: number; y: number };
  pull: Point;
  notebook: Box;
  spots: Point[];
}

/** The notebook's words, as Quinn-Wai gave them (QWW-85), with a copy here of its own: curly apostrophes, "[often]" and the blank line. */
const NOTEBOOK_TEXT =
  "You found the secret message! As your reward, some brief context:\n" +
  "\n" +
  "I took inspo of the color scheme from the Aussie Open 2013 when I went, I was big into tennis as a kid! In my big tennis bag, which was nearly the same height as me, was always a notebook detailing important things like my breakthroughs from a practice session or reflecting on my strategy when I [often] lost my matches. My book-ish analytical ways in school couldn’t help but follow me to the tennis court as well! Enjoy playing around on my makeshift training grounds, and hit me up if you’d like to partner up for a game of doubles together!";

/** Call something on window.__sandbox, the page's test hook, and return what it gives back. */
const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const balls = (page: Page) => sandbox<Ball[]>(page, "balls()");
const ball = async (page: Page, id: number) => (await balls(page)).find((b) => b.id === id)!;
const cans = (page: Page) => sandbox<Can[]>(page, "cans()");
const scenery = (page: Page) => sandbox<Scenery>(page, "scenery()");
const bagState = (page: Page) => sandbox<{ open: boolean; pull: number }>(page, "bag()");
const notebookState = (page: Page) => sandbox<{ out: boolean; open: boolean }>(page, "notebook()");
/** Run the simulation forward without waiting for frames. */
const advance = (page: Page, seconds: number) => sandbox<void>(page, `advance(${seconds})`);
/** The ball currently sitting as the dot of the first or second "i". */
const dot = (page: Page, index: number) =>
  page.evaluate((i) => {
    const s = (window as any).__sandbox;
    const home = s.layout().dots[i];
    return s.balls().find((b: Ball) => b.pinned && Math.hypot(b.x - home.x, b.y - home.y) < 2) as Ball;
  }, index);

const notebookButton = (page: Page) => page.getByRole("button", { name: "Notebook" });
const notebookPage = (page: Page) => page.getByRole("dialog", { name: "Notebook" });
const clearButton = (page: Page) => page.getByRole("button", { name: "Clear the balls" });

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
});

/** Take the bag's pull with the mouse and drag it along the zip to its end, then give the notebook and the cans the time to come out. */
async function unzip(page: Page) {
  const s = await scenery(page);
  await page.mouse.move(s.pull.x, s.pull.y);
  await page.mouse.down();
  await page.mouse.move(s.zip.x1 + 8, s.pull.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await bagState(page)).open).toBe(true);
  await advance(page, 2);
}

/**
 * Tip a can over: take it by its base with nothing keeping it upright (the hand's grip set to 0), and lift it clear of the floor, up and a
 * little to the left, into free space. A can hung by its base hangs mouth down, and a tipped can lets its balls out. (A hand never lifts
 * dead straight, which is what would leave it balanced for ever. It is lifted high enough that a ball can come out of its mouth: a pile of
 * balls under it blocks the pour, as a pile would.) Lets the pour run for a while, and lets go.
 */
async function tipOver(page: Page, can: Can) {
  await page.evaluate(() => ((window as any).__sandbox.params.canGrip = 0));
  const base = { x: can.x, y: can.y + can.height * 0.4 };
  await page.mouse.move(base.x, base.y);
  await page.mouse.down();
  await page.mouse.move(base.x - can.height * 0.3, base.y - can.height * 1.6, { steps: 10 });
  await advance(page, 2);
  await page.mouse.up();
  await page.evaluate(() => ((window as any).__sandbox.params.canGrip = 70));
}

/** The four corner buttons that are always on the page, as boxes in px. */
const cornerButtons = (page: Page) =>
  page.evaluate(() =>
    [".chip.credits", ".chip.clear", ".chip.sound", ".chip.toggle"].map((selector) => {
      const b = document.querySelector(selector)!.getBoundingClientRect();
      return { selector, left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    }),
  );

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const boxOfCan = (c: Can): Box => ({ left: c.x - c.width / 2, right: c.x + c.width / 2, top: c.y - c.height / 2, bottom: c.y + c.height / 2 });

// ---- The bench and the bag ----

test("the bench and the bag stand on the floor on the right, the bench running off the window's edge and starting to the right of the name", async ({ page }) => {
  const s = await scenery(page);
  const { width, height } = page.viewportSize()!;
  expect(s.bag.bottom).toBeCloseTo(height, 0);
  for (const leg of s.legs) expect(leg.bottom).toBeCloseTo(height, 0);
  expect(s.seat.right, "the bench is cut off by the right edge").toBeGreaterThan(width);
  expect(s.bag.right).toBeLessThan(s.seat.left);
  const nameRight = await page.evaluate(() => Math.max(...(window as any).__sandbox.layout().letters.flatMap((l: any) => l.loops.flat()).map((p: Point) => p.x)));
  expect(s.seat.left).toBeGreaterThan(nameRight);
  expect(s.bag.left).toBeGreaterThan(0);
});

test("a ball dropped over the bench seat comes to rest on it", async ({ page }) => {
  const s = await scenery(page);
  const d = await dot(page, 1);
  // Over the seat, a little in from its left end, and well above it. The dot is carried sideways at its own height, which is clear of the
  // name and of the row of buttons, and then down; the bench is to the right of the name.
  const over = { x: s.seat.left + 90, y: s.seat.top - 70 };
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(over.x, d.y, { steps: 8 });
  await page.mouse.move(over.x, over.y, { steps: 8 });
  await expect.poll(async () => Math.hypot((await ball(page, d.id)).x - over.x, (await ball(page, d.id)).y - over.y)).toBeLessThan(6);
  await page.waitForTimeout(120); // let it stop, so that it drops straight down
  await page.mouse.up();
  await advance(page, 3);
  const landed = await ball(page, d.id);
  expect(Math.hypot(landed.vx, landed.vy), "it has come to rest").toBeLessThan(5);
  expect(Math.abs(landed.y + landed.r - s.seat.top), "its underside is on the seat").toBeLessThan(2);
  expect(Math.abs(landed.x - over.x)).toBeLessThan(6);
});

test("the bench, the bag, the notebook and the cans never overlap a corner button", async ({ page }) => {
  const buttons = await cornerButtons(page);
  const before = await scenery(page);
  await unzip(page); // everything out: the notebook and the cans too
  const out = await cans(page);
  expect(out).toHaveLength(3);
  const parts: [string, Box][] = [
    ["the seat", before.seat],
    ...before.legs.map((leg, i): [string, Box] => [`leg ${i + 1}`, leg]),
    ["the bag", before.bag],
    ["the notebook", before.notebook],
    ...out.map((c, i): [string, Box] => [`can ${i + 1}`, boxOfCan(c)]),
  ];
  for (const [part, box] of parts) {
    for (const button of buttons) expect(overlaps(box, button), `${part} and the ${button.selector} button`).toBe(false);
  }
});

// ---- The zip ----

test("dragging the zip's pull along the bag opens it", async ({ page }) => {
  expect(await bagState(page)).toEqual({ open: false, pull: 0 });
  const s = await scenery(page);
  await page.mouse.move(s.pull.x, s.pull.y);
  await page.mouse.down();
  await page.mouse.move(s.zip.x1 + 8, s.pull.y, { steps: 12 });
  await page.mouse.up();
  expect(await bagState(page)).toEqual({ open: true, pull: 1 });
});

test("a plain click on the bag, or on the pull, does not open it", async ({ page }) => {
  const s = await scenery(page);
  await page.mouse.click((s.bag.left + s.bag.right) / 2, (s.bag.top + s.bag.bottom) / 2 + 10); // the bag's middle
  await page.mouse.click(s.bag.right - 20, s.bag.top + 20);
  await page.mouse.click(s.pull.x, s.pull.y); // on the pull, without moving it
  await page.mouse.dblclick(s.pull.x, s.pull.y);
  expect(await bagState(page)).toEqual({ open: false, pull: 0 });
  await advance(page, 2);
  expect(await cans(page)).toEqual([]);
});

test("dragging along the zip from anywhere but the pull does not open it", async ({ page }) => {
  const s = await scenery(page);
  const y = s.pull.y + 40; // a finger's width under the pull, on the bag
  await page.mouse.move(s.zip.x0 + 4, y);
  await page.mouse.down();
  await page.mouse.move(s.zip.x1 + 8, y, { steps: 12 });
  await page.mouse.up();
  expect(await bagState(page)).toEqual({ open: false, pull: 0 });
});

test("the pull follows the pointer along the zip, stays where it is let go, and takes up again from there", async ({ page }) => {
  const s = await scenery(page);
  const length = s.zip.x1 - s.zip.x0;
  await page.mouse.move(s.pull.x, s.pull.y);
  await page.mouse.down();
  await page.mouse.move(s.zip.x0 + length * 0.4, s.pull.y, { steps: 8 });
  expect((await bagState(page)).pull).toBeCloseTo(0.4, 1);
  await page.mouse.up();
  expect(await bagState(page)).toMatchObject({ open: false });
  expect((await bagState(page)).pull).toBeCloseTo(0.4, 1);

  // Where it was let go, it is taken up again, and the rest of the way opens the bag.
  const again = await scenery(page);
  expect(again.pull.x).toBeCloseTo(s.zip.x0 + length * 0.4, 0);
  await page.mouse.move(again.pull.x, again.pull.y);
  await page.mouse.down();
  await page.mouse.move(s.zip.x1 + 8, again.pull.y, { steps: 10 });
  await page.mouse.up();
  expect((await bagState(page)).open).toBe(true);
});

test("the pull cannot be taken once the bag is open", async ({ page }) => {
  await unzip(page);
  const s = await scenery(page);
  await page.mouse.move(s.pull.x, s.pull.y);
  await page.mouse.down();
  await page.mouse.move(s.zip.x0, s.pull.y, { steps: 8 });
  await page.mouse.up();
  expect(await bagState(page)).toEqual({ open: true, pull: 1 });
});

// ---- Out of the bag: the notebook and the cans ----

test("before the bag is opened there is no notebook and there are no cans, only the two balls", async ({ page }) => {
  expect(await cans(page)).toEqual([]);
  expect(await notebookState(page)).toEqual({ out: false, open: false });
  await expect(notebookButton(page)).toBeHidden();
  expect(await balls(page)).toHaveLength(2);
});

test("opening the bag brings out the notebook and 3 cans, each with 3 balls", async ({ page }) => {
  await unzip(page);
  const out = await cans(page);
  expect(out).toHaveLength(3);
  for (const can of out) expect(can.ballsLeft).toBe(3);
  expect(await notebookState(page)).toEqual({ out: true, open: false });
  await expect(notebookButton(page)).toBeVisible();
  expect(await balls(page), "the balls in the cans are not out of them yet").toHaveLength(2);
  // The cans stand on the floor at their spots, upright, left of the bag, and keep standing.
  const s = await scenery(page);
  await advance(page, 2);
  const standing = await cans(page);
  for (const [i, can] of standing.entries()) {
    expect(Math.abs(can.x - s.spots[i].x)).toBeLessThan(2);
    expect(Math.abs(can.y - s.spots[i].y)).toBeLessThan(2);
    expect(Math.abs(can.angle)).toBeLessThan(0.05);
  }
});

test("the cans and the notebook come out of the bag over a moment, not all at once", async ({ page }) => {
  const s = await scenery(page);
  await page.mouse.move(s.pull.x, s.pull.y);
  await page.mouse.down();
  await page.mouse.move(s.zip.x1 + 8, s.pull.y, { steps: 12 });
  await page.mouse.up();
  await advance(page, 0.05);
  expect(await cans(page), "nothing has landed yet").toHaveLength(0);
  await advance(page, 0.9);
  expect(await cans(page)).toHaveLength(3);
});

// ---- The notebook ----

test("clicking the notebook opens its page over the toy, with the words on it as real text", async ({ page }) => {
  await unzip(page);
  const address = page.url();
  await notebookButton(page).click();
  await expect(notebookPage(page)).toBeVisible();
  expect(await notebookState(page)).toEqual({ out: true, open: true });
  expect(page.url()).toBe(address);
  // Real text: found by its words, selectable, and not part of the canvas.
  await expect(notebookPage(page).getByText("You found the secret message!")).toBeVisible();
  expect(await notebookPage(page).locator(".notebook-page").evaluate((el) => getComputedStyle(el).userSelect)).not.toBe("none");
  expect(await notebookPage(page).locator("canvas").count()).toBe(0);
  await expect(page.locator("#court")).toBeVisible(); // the toy is still behind it
});

test("the page shows the notebook's text exactly", async ({ page }) => {
  await unzip(page);
  await notebookButton(page).click();
  const shown = await notebookPage(page).locator(".notebook-page").evaluate((el) => ({
    inner: (el as HTMLElement).innerText,
    paragraphs: [...el.querySelectorAll("p")].map((p) => p.textContent),
  }));
  expect(shown.paragraphs.join("\n\n")).toBe(NOTEBOOK_TEXT);
  expect(shown.inner.trim()).toBe(NOTEBOOK_TEXT);
  expect(shown.inner).toContain("[often]");
  expect(shown.paragraphs[0]).toBe("You found the secret message! As your reward, some brief context:");
});

test("the whole text is readable on the page, with nothing cut off, at this window's size", async ({ page }) => {
  await unzip(page);
  await notebookButton(page).click();
  await expect(notebookPage(page)).toBeVisible();
  const fit = await page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>(".notebook-page")!;
    const box = sheet.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(sheet);
    const text = range.getBoundingClientRect();
    const slack = 0.5;
    return {
      scrolls: sheet.scrollHeight > sheet.clientHeight + 1 || sheet.scrollWidth > sheet.clientWidth + 1,
      textInsidePage: text.left >= box.left - slack && text.right <= box.right + slack && text.top >= box.top - slack && text.bottom <= box.bottom + slack,
      pageInsideWindow: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      lastLine: [...sheet.querySelectorAll("p")].pop()!.getBoundingClientRect().bottom <= box.bottom,
      fontPx: parseFloat(getComputedStyle(sheet).fontSize),
    };
  });
  expect(fit.scrolls, "the page needs no scrolling").toBe(false);
  expect(fit.textInsidePage).toBe(true);
  expect(fit.pageInsideWindow).toBe(true);
  expect(fit.lastLine).toBe(true);
  expect(fit.fontPx, "type small enough to fit is still readable").toBeGreaterThanOrEqual(13);
});

/**
 * Where the open notebook's book and its text are: whether it needs scrolling, whether the words and the book are inside the window, and
 * how many pages (columns) the words are set in. The words' lines are told apart by which half of the page they are in.
 */
const bookFit = (page: Page) =>
  page.evaluate(() => {
    const book = document.querySelector<HTMLElement>(".notebook-book")!;
    const sheet = document.querySelector<HTMLElement>(".notebook-page")!;
    const close = document.querySelector<HTMLElement>(".notebook-overlay .close")!.getBoundingClientRect();
    const b = book.getBoundingClientRect();
    const p = sheet.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(sheet);
    const text = range.getBoundingClientRect();
    const middle = p.left + p.width / 2;
    const lines = [...range.getClientRects()].filter((r) => r.width > 1);
    const slack = 0.5;
    return {
      pages: getComputedStyle(sheet).columnCount,
      scrolls: book.scrollHeight > book.clientHeight + 1 || sheet.scrollHeight > sheet.clientHeight + 1 || sheet.scrollWidth > sheet.clientWidth + 1,
      textInsidePage: text.left >= p.left - slack && text.right <= p.right + slack && text.top >= p.top - slack && text.bottom <= p.bottom + slack,
      bookInsideWindow: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
      clearOfClose: b.top >= close.bottom - slack || b.left >= close.right || b.right <= close.left,
      onLeftPage: lines.filter((r) => r.right <= middle + slack).length,
      onRightPage: lines.filter((r) => r.left >= middle - slack).length,
      acrossBoth: lines.filter((r) => r.left < middle - slack && r.right > middle + slack).length,
      fontPx: parseFloat(getComputedStyle(sheet).fontSize),
    };
  });

test("the notebook lies open like a book: the words run from the left page onto the right on a wide window, and fill one page on a narrow one", async ({ page }) => {
  await unzip(page);
  await notebookButton(page).click();
  await expect(notebookPage(page)).toBeVisible();
  // On the windows of this project (all wider than 640 px) there are two facing pages, and the one text runs over both of them: lines on the
  // left page, lines on the right, and none across the gutter. It is still one block of real text, in order (the exact-text check below).
  const wide = await bookFit(page);
  expect(wide.pages).toBe("2");
  expect(wide.onLeftPage).toBeGreaterThan(3);
  expect(wide.onRightPage).toBeGreaterThan(3);
  expect(wide.acrossBoth).toBe(0);
  const where = await notebookPage(page).locator(".notebook-page").evaluate((sheet) => {
    const middle = sheet.getBoundingClientRect().left + sheet.getBoundingClientRect().width / 2;
    const centreOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    };
    const [first, second] = [...sheet.querySelectorAll("p")];
    // The first line starts the left page; the last words of the second paragraph end up on the right one.
    const last = document.createRange();
    last.selectNodeContents(second);
    last.setStart(second.firstChild!, second.textContent!.length - "doubles together!".length);
    return { firstOnLeft: first.getBoundingClientRect().right <= middle, endsOnRight: last.getBoundingClientRect().left >= middle, centre: centreOf(sheet) };
  });
  expect(where.firstOnLeft).toBe(true);
  expect(where.endsOnRight).toBe(true);

  // A narrow window, a phone held upright, has room for one page, and the whole text is on it.
  await page.setViewportSize({ width: 600, height: 700 });
  await expect.poll(async () => (await bookFit(page)).pages).toBe("1");
  const narrow = await bookFit(page);
  expect(narrow.scrolls).toBe(false);
  expect(narrow.textInsidePage).toBe(true);
  expect(narrow.onRightPage, "one page: nothing is on a second one").toBe(0);
});

/** Windows that the page has to be readable in, width by height: laptops, then the phones held sideways that phone.test.ts lists, iOS 26's Safari's, and a phone held upright. */
const WINDOWS_FOR_THE_BOOK: [number, number][] = [
  [1440, 800],
  [1280, 600],
  [1024, 600],
  [750, 280],
  [802, 293],
  [734, 343],
  [712, 325],
  [863, 360],
  [740, 360],
  [667, 375],
  [568, 320],
  [390, 664],
  [412, 839],
];

test("the whole text fits on the open notebook, with nothing cut off and nothing under the close button, in every window that matters", async ({ page }) => {
  await unzip(page);
  await notebookButton(page).click();
  await expect(notebookPage(page)).toBeVisible();
  for (const [width, height] of WINDOWS_FOR_THE_BOOK) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => page.evaluate(() => innerWidth)).toBe(width);
    const fit = await bookFit(page);
    const where = `${width} by ${height}`;
    expect(fit.scrolls, `${where}: needs no scrolling`).toBe(false);
    expect(fit.textInsidePage, `${where}: every word is on the page`).toBe(true);
    expect(fit.bookInsideWindow, `${where}: the book is inside the window`).toBe(true);
    expect(fit.clearOfClose, `${where}: the close button is not over the book`).toBe(true);
    expect(fit.fontPx, `${where}: the type is readable`).toBeGreaterThanOrEqual(14);
    if (fit.pages === "2") expect(fit.acrossBoth, `${where}: no line runs across the gutter`).toBe(0);
    expect(fit.pages, `${where}: two pages where there is room for two, one where there is not`).toBe(width > 640 ? "2" : "1");
  }
});

test("Escape closes the notebook", async ({ page }) => {
  await unzip(page);
  await notebookButton(page).click();
  await expect(notebookPage(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(notebookPage(page)).toBeHidden();
  expect(await notebookState(page)).toEqual({ out: true, open: false });
});

test("a click outside the notebook's page closes it, and does not hit a ball", async ({ page }) => {
  await unzip(page);
  await notebookButton(page).click();
  await expect(notebookPage(page)).toBeVisible();
  const sheet = (await notebookPage(page).locator(".notebook-page").boundingBox())!;
  // A click on the text itself leaves the page open...
  await notebookPage(page).getByText("You found the secret message!").click();
  await expect(notebookPage(page)).toBeVisible();
  // ...and one outside it closes it. If a dot is outside the page (it is on a desktop window), the click is on that ball and must not hit it.
  const dots = [await dot(page, 0), await dot(page, 1)];
  const outside = dots.find((d) => d.x - d.r > sheet.x + sheet.width || d.x + d.r < sheet.x || d.y - d.r > sheet.y + sheet.height || d.y + d.r < sheet.y);
  const { height } = page.viewportSize()!;
  const at = outside ? { x: outside.x + outside.r * 0.8, y: outside.y } : { x: 6, y: height - 6 }; // the window's own corner is outside the page too
  await page.mouse.click(at.x, at.y);
  await expect(notebookPage(page)).toBeHidden();
  expect(await sandbox(page, "lastHit()")).toBeNull();
  if (outside) expect((await ball(page, outside.id)).pinned).toBe(true);
});

test("the close control closes the notebook, from the keyboard or with the mouse", async ({ page }) => {
  await unzip(page);
  const close = notebookPage(page).getByRole("button", { name: "Close" });
  // It has the focus the moment the page opens, so Enter presses it.
  await notebookButton(page).click();
  await expect(close).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(notebookPage(page)).toBeHidden();

  await notebookButton(page).click();
  await close.click();
  await expect(notebookPage(page)).toBeHidden();
});

test("the notebook can be opened from the keyboard", async ({ page }) => {
  await unzip(page);
  await notebookButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(notebookPage(page)).toBeVisible();
});

// ---- The cans ----

test("a can is picked up and carried like a ball: it follows the pointer, and lets go when it does", async ({ page }) => {
  await unzip(page);
  const [, , far] = await cans(page); // the one furthest from the bag
  const grab = { x: far.x, y: far.y - far.height * 0.2 }; // on its upper half
  const to = { x: far.x - far.height * 0.5, y: grab.y - far.height * 0.4 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expect.poll(async () => (await cans(page)).find((c) => c.id === far.id)!.held).toBe(true);
  // It hangs from the point where it was taken, which follows the pointer: the can's middle is as far below the pointer as it was below the press.
  await expect
    .poll(async () => {
      const c = (await cans(page)).find((k) => k.id === far.id)!;
      return Math.hypot(c.x - (to.x - (grab.x - far.x)), c.y - (to.y - (grab.y - far.y)));
    })
    .toBeLessThan(far.height * 0.15);
  const held = (await cans(page)).find((c) => c.id === far.id)!;
  expect(Math.abs(held.angle), "a gentle carry keeps it upright").toBeLessThan(0.5);
  expect(held.ballsLeft).toBe(3);
  await page.mouse.up();
  expect((await cans(page)).find((c) => c.id === far.id)!.held).toBe(false);
});

test("a can lets go while it is moving and is thrown the way it was going", async ({ page }) => {
  await unzip(page);
  const [, , far] = await cans(page);
  const grab = { x: far.x, y: far.y - far.height * 0.2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x - 10, grab.y - 20, { steps: 3 }); // far enough to lift it
  // The pointer goes a long way off, to the left, so the can is still chasing it, fast, when it is let go. In one step in the page, with
  // the physics run by hand, so that no frame can slip in between and let the can catch up with the pointer and stop.
  const thrown = await page.evaluate(
    ({ id, to }) => {
      const sandbox = (window as any).__sandbox;
      const court = document.getElementById("court")!;
      court.dispatchEvent(new PointerEvent("pointermove", { clientX: to.x, clientY: to.y }));
      sandbox.advance(12 / 240);
      court.dispatchEvent(new PointerEvent("pointerup"));
      sandbox.advance(1 / 240);
      return sandbox.cans().find((c: Can) => c.id === id) as Can;
    },
    { id: far.id, to: { x: grab.x - 600, y: grab.y - 60 } },
  );
  await page.mouse.up();
  expect(thrown.held).toBe(false);
  expect(thrown.vx, "it keeps going left").toBeLessThan(-200);
});

test("a tipped can pours its balls out, and a can that is carried upright keeps them", async ({ page }) => {
  await unzip(page);
  const [near, middle, far] = await cans(page);

  // Carried gently, by its upper half, it stays upright and full.
  const grab = { x: middle.x, y: middle.y - middle.height * 0.2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y - middle.height * 0.3, { steps: 20 });
  await advance(page, 1);
  await page.mouse.up();
  expect((await cans(page)).find((c) => c.id === middle.id)!.ballsLeft).toBe(3);
  expect(await balls(page), "nothing has come out of it").toHaveLength(2);
  expect((await cans(page)).find((c) => c.id === near.id)!.ballsLeft).toBe(3);

  // Tipped over, a can lets its balls out, and they are real balls on the court.
  await tipOver(page, far);
  const emptied = (await cans(page)).find((c) => c.id === far.id)!;
  expect(emptied.ballsLeft, "balls have left the tipped can").toBeLessThan(3);
  expect(await balls(page), "and each is a ball on the court").toHaveLength(2 + (3 - emptied.ballsLeft));
  // The others kept theirs.
  expect((await cans(page)).filter((c) => c.id !== far.id).every((c) => c.ballsLeft === 3)).toBe(true);
});

test("restart puts the cans back in the bag, full, and zips it again with the notebook inside", async ({ page }) => {
  await unzip(page);
  await notebookButton(page).click();
  await page.keyboard.press("Escape");
  // Empty one of the cans first, so that "full again" means something.
  const [, , far] = await cans(page);
  await tipOver(page, far);
  expect((await cans(page)).some((c) => c.ballsLeft < 3)).toBe(true);

  await clearButton(page).click();
  expect(await cans(page), "the cans are back in the bag").toEqual([]);
  expect(await bagState(page), "the bag is zipped").toEqual({ open: false, pull: 0 });
  expect(await notebookState(page)).toEqual({ out: false, open: false });
  await expect(notebookButton(page)).toBeHidden();
  const zipped = await scenery(page);
  expect(zipped.pull.x).toBeCloseTo(zipped.zip.x0, 0);

  // And they come out again, full.
  await unzip(page);
  const again = await cans(page);
  expect(again).toHaveLength(3);
  for (const can of again) expect(can.ballsLeft).toBe(3);
  expect(await notebookState(page)).toEqual({ out: true, open: false });
});

test("a window that is made a different size keeps the bag open, the cans where they are and the notebook out", async ({ page }) => {
  await unzip(page);
  const before = await cans(page);
  const { width, height } = page.viewportSize()!;
  await page.setViewportSize({ width: width - 60, height: height - 40 });
  await expect.poll(async () => (await scenery(page)).bag.bottom).toBeCloseTo(height - 40, 0);
  expect(await bagState(page)).toEqual({ open: true, pull: 1 });
  expect(await notebookState(page)).toEqual({ out: true, open: false });
  await expect(notebookButton(page)).toBeVisible();
  const after = await cans(page);
  expect(after).toHaveLength(before.length);
  for (const can of after) expect(can.ballsLeft).toBe(3);
});

// ---- The page's test hook ----

test("window.__sandbox keeps balls(), advance() and effects(), and adds the bag, the notebook and the cans as read-only state", async ({ page }) => {
  const api = await page.evaluate(() => {
    const s = (window as any).__sandbox;
    const before = s.balls().length;
    s.advance(0.1);
    return {
      before,
      after: s.balls().length,
      effects: Object.keys(s.effects()).sort(),
      bag: Object.keys(s.bag()).sort(),
      notebook: Object.keys(s.notebook()).sort(),
      cans: s.cans(),
    };
  });
  expect(api).toEqual({ before: 2, after: 2, effects: ["bursts", "trailPoints"], bag: ["open", "pull"], notebook: ["open", "out"], cans: [] });
  await unzip(page);
  const [can] = await cans(page);
  expect(Object.keys(can).sort()).toEqual(["angle", "ballsLeft", "height", "held", "id", "vx", "vy", "width", "x", "y"]);
});

// ---- Under ?tune ----

test("with ?tune, the bench, the bag and the cans have sliders; the furniture's follow the court, the pour and grip ones leave it alone", async ({ page }) => {
  await page.goto("./?tune");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  const labels = [
    "bench: how much shows",
    "bench: seat height",
    "bag: length",
    "bag: height",
    "bag: gap to the bench",
    "notebook: how far out of the bag",
    "can: pours past",
    "can: time between balls",
    "can: speed a ball leaves at",
    "can: grip on a carried can",
  ];
  for (const label of labels) await expect(page.getByLabel(label), label).toHaveCount(1);

  // Moving the seat moves the bench, and so remakes the court (which gives the name a new layout).
  const before = await scenery(page);
  await page.getByLabel("bench: seat height").fill("0.55");
  await expect.poll(async () => (await scenery(page)).seat.top).toBeLessThan(before.seat.top - 20);
  // A lower bag stands lower. (A higher one would be held down by the name in a short window, where there is no room for it.)
  await page.getByLabel("bag: height").fill("0.15");
  await expect.poll(async () => (await scenery(page)).bag.top).toBeGreaterThan(before.bag.top + 20);

  // The pour and the grip are read as a can is poured and held, so moving them leaves the court as it is.
  const untouched = await page.evaluate(() => {
    const sandbox = (window as any).__sandbox;
    const slider = (text: string) =>
      [...document.querySelectorAll<HTMLInputElement>("input[type=range]")].find((input) => input.parentElement!.textContent!.includes(text))!;
    const layout = sandbox.layout();
    const balls = JSON.stringify(sandbox.balls());
    for (const text of ["can: pours past", "can: time between balls", "can: speed a ball leaves at", "can: grip on a carried can"]) {
      const input = slider(text);
      input.value = String(Number(input.min) + (Number(input.max) - Number(input.min)) / 2);
      input.dispatchEvent(new Event("input"));
    }
    return { sameLayout: sandbox.layout() === layout, sameBalls: JSON.stringify(sandbox.balls()) === balls, pours: sandbox.params.canPourAngle };
  });
  expect(untouched.sameLayout).toBe(true);
  expect(untouched.sameBalls).toBe(true);
  expect(untouched.pours).toBeGreaterThan(40);
});
