// The phone checks: what a finger can do to the toy, and what the page asks of a phone. They run on phone-sized
// browser windows with a touch screen and no mouse (the projects in playwright.config.ts): sideways, which is how the toy
// is played, and upright, where a prompt asks for the phone to be turned. The checks of the other spec files run on the
// sideways phones too.
//
// It is still Chromium's engine, so some of what a phone does can only be approximated here. Each place says so. What
// no browser test can show goes on Quinn-Wai's list for a real iPhone and a real Android phone: Safari's toolbars
// growing and shrinking, pull to refresh, swiping back from the screen's edge, iOS's rubber band and its long-press callout.

import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { params } from "../src/params";

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
const lastHit = (page: Page) => sandbox<{ id: number; dir: Point } | null>(page, "lastHit()");
/** The ball currently sitting as the dot of the first or second "i". */
const dot = (page: Page, index: number) =>
  page.evaluate((i) => {
    const s = (window as any).__sandbox;
    const home = s.layout().dots[i];
    return s.balls().find((b: Ball) => b.pinned && Math.hypot(b.x - home.x, b.y - home.y) < 2) as Ball;
  }, index);
const size = (page: Page) => page.viewportSize()!;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
/**
 * Wait until every fade on the page has finished: the contact links slide in over 0.15 s. (The rotate prompt's phone tips
 * for ever, and a thing that never finishes is not a fade to wait for.)
 */
const fadesDone = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished),
    ).then(() => undefined),
  );

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
});

/**
 * Fingers on the screen, sent through the browser's own touch input (the Chrome DevTools protocol). The page gets real touch
 * events and real pointer events of type "touch", and the browser's own gestures (scrolling, pinching, pull to refresh) get
 * their say as they would on a phone. `page.touchscreen` can only tap; this holds, drags and uses several fingers at once.
 * A press or a move names every finger that is down, which is how the browser tells which one is new or has moved; a lift
 * names only the finger that lifts. Fingers are numbered by the caller, from 1.
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

/**
 * Where the name's ink, the two balls and every corner control that is showing are, all in px. `clearest` is the least air
 * between the name or a ball and any control showing.
 */
async function whatIsWhere(page: Page) {
  await fadesDone(page);
  return page.evaluate(() => {
    const s = (window as any).__sandbox;
    const letters = s.layout().letters as { loops: Point[][] }[];
    const ink = letters.flatMap((l) => l.loops.flat());
    const dots = (s.balls() as Ball[]).filter((b) => b.pinned);
    const controls = [...document.querySelectorAll<HTMLElement>(".chip")]
      .map((el) => ({ name: el.getAttribute("aria-label") ?? el.textContent!, box: el.getBoundingClientRect(), shown: getComputedStyle(el).visibility !== "hidden" }))
      .filter((c) => c.shown && c.box.width > 0);
    const gapTo = (box: DOMRect, x: number, y: number) => Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
    let clearest = { name: "", gap: Infinity };
    for (const c of controls) {
      for (const p of ink) if (gapTo(c.box, p.x, p.y) < clearest.gap) clearest = { name: c.name, gap: gapTo(c.box, p.x, p.y) };
      for (const b of dots) if (gapTo(c.box, b.x, b.y) - b.r < clearest.gap) clearest = { name: c.name, gap: gapTo(c.box, b.x, b.y) - b.r };
    }
    const xs = [...ink.map((p) => p.x), ...dots.flatMap((b) => [b.x - b.r, b.x + b.r])];
    const ys = [...ink.map((p) => p.y), ...dots.flatMap((b) => [b.y - b.r, b.y + b.r])];
    return {
      width: innerWidth,
      height: innerHeight,
      inkBox: { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) },
      controls: controls.map((c) => c.name),
      clearest,
    };
  });
}

/** The name and both balls lie wholly inside the window, with a margin all round, and sit in the middle of it. */
function expectNameOnScreen(where: Awaited<ReturnType<typeof whatIsWhere>>) {
  const { width, height, inkBox } = where;
  const margin = 8;
  expect(inkBox.left, "the name's left edge").toBeGreaterThanOrEqual(margin);
  expect(inkBox.top, "the name's top, a ball's top included").toBeGreaterThanOrEqual(margin);
  expect(width - inkBox.right, "room right of the name").toBeGreaterThanOrEqual(margin);
  expect(height - inkBox.bottom, "room under the name").toBeGreaterThanOrEqual(margin);
  // The letters' own side bearings put the ink a hair off the middle; near 3% of the width would be a layout that leans.
  expect(Math.abs(inkBox.left - (width - inkBox.right)), "the gap on the left against the gap on the right").toBeLessThan(width * 0.03);
}

// ---- Every phone ----

test("window.__sandbox still has balls(), advance() and effects() on a phone", async ({ page }) => {
  const api = await page.evaluate(() => {
    const s = (window as any).__sandbox;
    const before = s.balls().length;
    s.advance(0.1);
    return { before, after: s.balls().length, effects: Object.keys(s.effects()).sort() };
  });
  expect(api).toEqual({ before: 2, after: 2, effects: ["bursts", "trailPoints"] });
});

test("every corner control is at least 44 by 44 px: the row at the top right, the ? and its three links, and the close button of the credits", async ({ page }) => {
  const sizes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".chip")]
        .map((el) => ({ name: el.getAttribute("aria-label") ?? el.textContent!, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, shown: getComputedStyle(el).visibility !== "hidden" }))
        .filter((c) => c.shown && c.width > 0),
    );
  // A phone's pixel density makes a box of 44 px come out at 43.99998 here and there, which is the layout's own rounding and not a smaller button.
  const rounding = 0.05;
  const expectBigEnough = (all: { name: string; width: number; height: number }[], names: string[]) => {
    expect(all.map((c) => c.name).sort()).toEqual([...names].sort());
    for (const c of all) {
      expect(c.width, `the ${c.name} button's width`).toBeGreaterThanOrEqual(44 - rounding);
      expect(c.height, `the ${c.name} button's height`).toBeGreaterThanOrEqual(44 - rounding);
    }
  };

  expectBigEnough(await sizes(), ["Credits", "Clear the balls", "Sound", "Contact"]);

  await page.getByRole("button", { name: "Contact" }).tap();
  await expect(page.getByRole("link", { name: "LinkedIn" })).toBeVisible();
  expectBigEnough(await sizes(), ["Credits", "Clear the balls", "Sound", "Contact", "Email", "GitHub", "LinkedIn"]);

  await page.getByRole("button", { name: "Credits", exact: true }).tap();
  await expect(page.getByRole("dialog", { name: "Credits" })).toBeVisible();
  expectBigEnough(await sizes(), ["Credits", "Clear the balls", "Sound", "Contact", "Email", "GitHub", "LinkedIn", "Close"]);
});

test("tapping the ? with a finger opens its three links, and tapping it again closes them", async ({ page }) => {
  const contact = page.getByRole("navigation", { name: "Contact" });
  const toggle = contact.getByRole("button", { name: "Contact" });
  // Looked up by tag, not by role: a link that is not showing is not in the page's accessibility tree, and a role query would not find it.
  const links = await contact.locator("a.chip").all();
  expect(links).toHaveLength(3);
  for (const link of links) await expect(link).toBeHidden();

  await toggle.tap();
  for (const link of links) await expect(link).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // A finger anywhere on the box of a link, or of the ? itself, lands on that control and not on a neighbour: the lowest link used to
  // reach 6 px down over the top of the ? (the bridge that lets a mouse travel between chips), and each link over the top of the next.
  await fadesDone(page);
  for (const control of [...links, toggle]) {
    const box = (await control.boundingBox())!;
    // The buttons are round (their corners take no touch), so the points are the middle and the middle of each edge, a hair inside it.
    for (const [x, y] of [[0.5, 0.5], [0.5, 0.04], [0.5, 0.96], [0.04, 0.5], [0.96, 0.5]]) {
      const landed = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest("a, button")?.getAttribute("aria-label"), [box.x + box.width * x, box.y + box.height * y]);
      expect(landed, `a finger ${Math.round(x * 100)}% across and ${Math.round(y * 100)}% down the ${await control.getAttribute("aria-label")} button`).toBe(await control.getAttribute("aria-label"));
    }
  }

  // This is the second tap that a finger's left-over hover used to defeat: the links stayed open, and only a tap elsewhere shut them.
  await toggle.tap();
  for (const link of links) await expect(link).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("the page asks the browser to keep its own gestures out of it: touch-action, overscroll-behavior and text selection", async ({ page }) => {
  const style = await page.evaluate(() => {
    const css = (el: Element, property: string) => getComputedStyle(el).getPropertyValue(property);
    const canvas = document.getElementById("court")!;
    return {
      htmlOverscroll: [css(document.documentElement, "overscroll-behavior-x"), css(document.documentElement, "overscroll-behavior-y")],
      bodyOverscroll: [css(document.body, "overscroll-behavior-x"), css(document.body, "overscroll-behavior-y")],
      bodyTouchAction: css(document.body, "touch-action"),
      canvasTouchAction: css(canvas, "touch-action"),
      canvasUserSelect: css(canvas, "user-select"),
      tapHighlight: css(canvas, "-webkit-tap-highlight-color"),
    };
  });
  // "none" on the page stops a push past its edge from becoming a pull to refresh, a bounce or a swipe back, and on the body and
  // the canvas stops the browser from scrolling, pinching or zooming under a finger that is playing. A long press is not a text selection.
  // Pull to refresh and swipe back themselves cannot be made to happen in this browser: these properties are what asks for them to be off.
  // (-webkit-touch-callout, iOS's long-press menu, is not a property Chromium knows; src/phone.test.ts reads it from the stylesheet that ships.)
  expect(style).toEqual({
    htmlOverscroll: ["none", "none"],
    bodyOverscroll: ["none", "none"],
    bodyTouchAction: "none",
    canvasTouchAction: "none",
    canvasUserSelect: "none",
    tapHighlight: "rgba(0, 0, 0, 0)",
  });
});

test("the page has nothing to scroll, and the canvas is exactly the window that is on screen", async ({ page }) => {
  const m = await page.evaluate(() => {
    const root = document.scrollingElement!;
    window.scrollTo(0, 200); // would move a page that could scroll
    window.scrollTo(200, 0);
    const canvas = document.getElementById("court")!;
    const box = canvas.getBoundingClientRect();
    const visible = window.visualViewport!;
    return {
      overflow: [root.scrollWidth - innerWidth, root.scrollHeight - innerHeight],
      scrolled: [window.scrollX, window.scrollY],
      canvas: [box.left, box.top, box.width, box.height],
      window: [0, 0, visible.width, visible.height],
      position: getComputedStyle(canvas).position,
    };
  });
  expect(m.overflow).toEqual([0, 0]);
  expect(m.scrolled).toEqual([0, 0]);
  expect(m.canvas).toEqual(m.window);
  // On a phone, 100vh is the window with the browser's toolbars folded away, taller than what shows while they are out, which would put the
  // floor and the bottom corner under the toolbar. A fixed box fills the window that is showing. This browser has no toolbars to grow
  // and shrink, so the difference itself can only be seen on a real phone.
  expect(m.position).toBe("fixed");
});

test("a swipe on the empty toy, a pull down from the top, a push in from the edge and a swipe that starts on a button scroll nothing and are not taken over by the browser", async ({ page }) => {
  const { width, height } = size(page);
  const fingers = await Fingers.on(page);
  const address = page.url();
  await page.evaluate(() => {
    const w = window as any;
    w.__alive = true;
    w.__cancels = 0;
    // A browser that takes a touch for a scroll or a pinch of its own cancels the page's pointer.
    for (const type of ["pointercancel", "touchcancel"]) window.addEventListener(type, () => w.__cancels++, true);
  });
  const sound = (await page.getByRole("switch", { name: "Sound" }).boundingBox())!;

  const swipes: [string, Point, Point][] = [
    ["up over the empty toy", { x: width / 2, y: height - 30 }, { x: width / 2, y: 40 }],
    ["down from the top edge, as to pull the page to refresh", { x: width / 2, y: 2 }, { x: width / 2, y: height - 20 }],
    ["right from the left edge, as to swipe back", { x: 2, y: height / 2 }, { x: width * 0.6, y: height / 2 }],
    ["down from the sound button", { x: sound.x + sound.width / 2, y: sound.y + sound.height / 2 }, { x: sound.x + sound.width / 2, y: height - 20 }],
  ];
  const settled = () =>
    page.evaluate(() => ({
      cancels: (window as any).__cancels as number,
      alive: (window as any).__alive as boolean, // a page that had been refreshed would have lost this
      scroll: [window.scrollX, window.scrollY, document.scrollingElement!.scrollLeft, document.scrollingElement!.scrollTop],
      zoom: window.visualViewport!.scale,
      pan: [window.visualViewport!.offsetLeft, window.visualViewport!.offsetTop],
    }));
  for (const [what, from, to] of swipes) {
    await fingers.press(1, from);
    await fingers.move(1, to, 10);
    await fingers.lift(1);
    expect(await settled(), `a swipe ${what}`).toEqual({ cancels: 0, alive: true, scroll: [0, 0, 0, 0], zoom: 1, pan: [0, 0] });
  }
  expect(page.url(), "and no swipe took the page anywhere").toBe(address);

  // The same swipe on a page that lets the browser have its gestures is cancelled, which is what the count above is looking for, so that
  // a count of nothing means something.
  await page.addStyleTag({ content: "html, body, canvas { touch-action: auto !important; overscroll-behavior: auto !important }" });
  await fingers.press(1, swipes[0][1]);
  await fingers.move(1, swipes[0][2], 10);
  await fingers.lift(1);
  expect((await settled()).cancels, "a swipe on a page that does not ask for its gestures to be off").toBeGreaterThan(0);
});

test("a pinch does not zoom the page", async ({ page }) => {
  const { width, height } = size(page);
  const cdp = await page.context().newCDPSession(page);
  const pinch = () => cdp.send("Input.synthesizePinchGesture", { x: width / 2, y: height / 2, scaleFactor: 2, relativeSpeed: 800, gestureSourceType: "touch" });
  const zoom = () => page.evaluate(() => window.visualViewport!.scale);

  await pinch();
  await page.waitForTimeout(250); // a zoom, if one is coming, animates in over a few frames; there is nothing to poll for when it does not come
  expect(await zoom()).toBe(1);

  // The same pinch zooms a page that lets the browser have it: the check above looked at something that can happen.
  await page.addStyleTag({ content: "html, body, canvas { touch-action: auto !important }" });
  await pinch();
  await expect.poll(zoom).toBeGreaterThan(1.5);
});

// ---- A phone held sideways ----

// The two groups below are told apart by their titles, which playwright.config.ts uses to run each one only on the phones
// that are held that way: "a phone held sideways" on the landscape projects, "a phone held upright" on the portrait ones.
test.describe("a phone held sideways", () => {
  test("the rotate prompt is not shown", async ({ page }) => {
    await expect(page.locator(".rotate-note")).toBeHidden();
  });

  test("the whole name and both balls are on screen, centred, and clear of every corner control", async ({ page }) => {
    // The contact links open, so that they count as corner controls too.
    await page.getByRole("button", { name: "Contact" }).tap();
    const where = await whatIsWhere(page);
    expect(where.controls.sort()).toEqual(["Clear the balls", "Contact", "Credits", "Email", "GitHub", "LinkedIn", "Sound"]);
    expectNameOnScreen(where);
    expect(where.clearest.gap, `the air between the name or a ball and the ${where.clearest.name} button`).toBeGreaterThanOrEqual(8);
  });

  test("a finger tap under a ball hits it and sends it up", async ({ page }) => {
    const d = await dot(page, 0);
    await page.touchscreen.tap(d.x, d.y + d.r * 0.8);
    const hit = await lastHit(page);
    expect(hit, "a tap with a finger counts as a hit").not.toBeNull();
    expect(hit!.id).toBe(d.id);
    expect(hit!.dir.y).toBeLessThan(-0.95);
    await advance(page, 1 / 240);
    const after = await ball(page, d.id);
    expect(after.pinned).toBe(false);
    expect(after.vy).toBeLessThan(0);
    expect(Math.abs(after.vx)).toBeLessThan(Math.abs(after.vy) * 0.2);
  });

  test("a finger tap a finger's width from a ball still hits it, and one well outside its reach does not", async ({ page }) => {
    const d = await dot(page, 0);
    // How far from a ball's middle a finger still hits it: the bigger of a number of ball radii and the floor for fingers.
    const reach = Math.max(d.r * params.hitReach, params.touchMinHitReachPx);
    await page.touchscreen.tap(d.x, d.y + reach + 8);
    expect(await lastHit(page), "a tap well outside").toBeNull();
    expect((await ball(page, d.id)).pinned).toBe(true);

    await page.touchscreen.tap(d.x, d.y + reach - 2);
    expect((await lastHit(page))?.id, "a tap just inside a finger's reach").toBe(d.id);
    expect(reach - 2, "farther than the ball is wide, so that this is a finger's reach and not the ball's").toBeGreaterThan(d.r * 2);
    expect((await ball(page, d.id)).pinned).toBe(false);
  });

  test("a finger pressing a ball and dragging carries it along, and lifting lets it go", async ({ page }) => {
    const fingers = await Fingers.on(page);
    const d = await dot(page, 0);
    const to = { x: d.x + 120, y: d.y - 40 }; // clear air above the name
    await fingers.press(1, d);
    await fingers.move(1, { x: d.x + 20, y: d.y - 5 }, 2); // far enough to lift the ball
    await fingers.move(1, to, 10);
    await expect.poll(async () => distance(await ball(page, d.id), to)).toBeLessThan(6);
    expect((await ball(page, d.id)).held).toBe(true);
    await fingers.lift(1);
    await expect.poll(async () => (await ball(page, d.id)).held).toBe(false);
  });

  test("a finger pressed a finger's width from a ball still picks it up and carries it, and one pressed well outside its reach carries nothing", async ({ page }) => {
    const fingers = await Fingers.on(page);
    const d = await dot(page, 0);
    // How far from a ball's middle a finger still picks it up: the bigger of a number of ball radii and the floor for fingers. On a phone
    // the floor is the larger (a ball is about 21 px across), so a mouse pressing this far out would have missed the ball.
    const reach = Math.max(d.r * params.grabReach, params.touchMinGrabReachPx);

    await fingers.press(1, { x: d.x, y: d.y + reach + 10 });
    await fingers.move(1, { x: d.x + 60, y: d.y + reach + 10 }, 4);
    await fingers.lift(1);
    expect((await ball(page, d.id)).held, "pressed well outside its reach").toBe(false);
    expect((await ball(page, d.id)).pinned).toBe(true);

    await fingers.press(1, { x: d.x, y: d.y + reach - 2 });
    await fingers.move(1, { x: d.x + 60, y: d.y + reach - 2 }, 4);
    await expect.poll(async () => (await ball(page, d.id)).held).toBe(true);
    await fingers.lift(1);
    await expect.poll(async () => (await ball(page, d.id)).held).toBe(false);
  });

  test("a finger held still on a ball picks it up, and lifting it again is not a hit", async ({ page }) => {
    const fingers = await Fingers.on(page);
    const d = await dot(page, 0);
    await fingers.press(1, d);
    // After the time a tap may last (params.tapMaxMs) a press that has not moved turns into a pick-up; the page decides it on a frame.
    await expect.poll(async () => (await ball(page, d.id)).held, { timeout: 5000 }).toBe(true);
    await fingers.lift(1);
    await expect.poll(async () => (await ball(page, d.id)).held).toBe(false);
    expect(await lastHit(page)).toBeNull();
  });

  test("lifting a finger while the ball is still moving throws it the way it was moving", async ({ page }) => {
    const fingers = await Fingers.on(page);
    const d = await dot(page, 0);
    // Far along, in clear air above the name and below the row of buttons, so that the ball has a long run before it reaches the finger.
    const far = { x: size(page).width - 40, y: 84 };
    // The run is made slower than it plays, so that there is a long stretch in which the ball is clearly moving and the finger is still far
    // ahead, and a busy machine cannot make the test miss it. What is looked at, that a ball is thrown the way it was going, does not depend on the speed.
    await page.evaluate(() => ((window as any).__sandbox.params.carrySpeed = 3));
    await fingers.press(1, d);
    await fingers.move(1, { x: d.x + 20, y: d.y - 8 }, 2);
    await fingers.move(1, far, 3);
    // The ball chases the finger as fast as it carries; lift while it is clearly moving.
    await expect
      .poll(async () => {
        const b = await ball(page, d.id);
        return Math.hypot(b.vx, b.vy);
      }, { intervals: [5, 10, 20] })
      .toBeGreaterThan(500);
    await fingers.lift(1);
    const thrown = await ball(page, d.id);
    expect(thrown.held).toBe(false);
    expect(thrown.vx, "it keeps going the way it was").toBeGreaterThan(300);
    expect(Math.abs(thrown.vy)).toBeLessThan(thrown.vx);
    expect(distance(thrown, far), "and the finger was still a long way ahead of it").toBeGreaterThan(100);
  });

  test("a second finger neither steers nor drops the ball the first finger is carrying", async ({ page }) => {
    const fingers = await Fingers.on(page);
    const { width, height } = size(page);
    const d = await dot(page, 0);
    const holding = { x: d.x + 100, y: d.y - 40 };
    const elsewhere = { x: width / 2, y: height - 30 }; // empty screen, well away from the ball

    await fingers.press(1, d);
    await fingers.move(1, { x: d.x + 20, y: d.y - 5 }, 2);
    await fingers.move(1, holding, 8);
    await expect.poll(async () => distance(await ball(page, d.id), holding)).toBeLessThan(6);

    // A second finger comes down far away and wanders. If the ball listened to it, it would set off for that finger.
    await fingers.press(2, elsewhere);
    await fingers.move(2, { x: elsewhere.x + 80, y: elsewhere.y - 20 }, 5);
    await fingers.move(2, { x: elsewhere.x - 60, y: elsewhere.y }, 5);
    await advance(page, 0.5);
    let now = await ball(page, d.id);
    expect(now.held, "still in the first finger's hand").toBe(true);
    expect(distance(now, holding), "still where the first finger holds it").toBeLessThan(6);

    // And when it lifts, the ball the other finger holds is not let go with it.
    await fingers.lift(2);
    await advance(page, 0.1);
    now = await ball(page, d.id);
    expect(now.held).toBe(true);
    expect(distance(now, holding)).toBeLessThan(6);

    await fingers.lift(1);
    await expect.poll(async () => (await ball(page, d.id)).held).toBe(false);
  });

  test("a finger resting on empty screen does not stop another finger from hitting a ball", async ({ page }) => {
    const fingers = await Fingers.on(page);
    const { height } = size(page);
    const resting = { x: 40, y: height - 40 }; // a thumb on the bottom left corner, which is empty
    const d = await dot(page, 0);
    await fingers.press(1, resting);
    await fingers.press(2, { x: d.x, y: d.y + d.r * 0.8 });
    await fingers.lift(2);
    expect((await lastHit(page))?.id, "the second finger's tap is a hit").toBe(d.id);
    expect((await ball(page, d.id)).pinned).toBe(false);
    // The resting finger can still move and lift without anything happening to the toy.
    await fingers.move(1, { x: resting.x + 30, y: resting.y }, 2);
    await fingers.lift(1);
  });

  test("with ?tune, a button tuned smaller than 44 px is still 44 px, and a ball pressed against it is stopped at that size", async ({ page }) => {
    await page.goto("./?tune");
    await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
    await page.getByLabel("button icon size").fill("24");

    const buttons = [page.getByRole("button", { name: "Credits", exact: true }), page.getByRole("button", { name: "Clear the balls" }), page.getByRole("switch", { name: "Sound" }), page.getByRole("button", { name: "Contact" })];
    for (const button of buttons) {
      const box = (await button.boundingBox())!;
      const name = (await button.getAttribute("aria-label")) ?? "";
      expect(box.width, `the ${name} button's width`).toBeCloseTo(44, 1);
      expect(box.height, `the ${name} button's height`).toBeCloseTo(44, 1);
    }
    // The slider did take hold: the icon in the button is the 24 px that was asked for, in a button that is not the 32 px a mouse would get.
    expect(await page.getByRole("switch", { name: "Sound" }).locator("svg").evaluate((el) => getComputedStyle(el).width)).toBe("24px");

    // The button is a solid disc in the toy, as big as its box. Carry the right-hand ball up to the sound button and push it against the
    // button with the finger ending in its middle: the ball is stopped at the button's surface, a ball's radius and the button's from its
    // middle. (A disc of the icon's size would let it get 6 px closer.)
    const sound = (await buttons[2].boundingBox())!;
    const middle = { x: sound.x + sound.width / 2, y: sound.y + sound.height / 2 };
    const fingers = await Fingers.on(page);
    const d = await dot(page, 1);
    await fingers.press(1, d);
    await fingers.move(1, { x: middle.x, y: d.y }, 8);
    await fingers.move(1, middle, 8);
    const contact = sound.width / 2 + d.r;
    await expect.poll(async () => distance(await ball(page, d.id), middle)).toBeLessThan(contact + 6);
    await advance(page, 0.5);
    const stopped = distance(await ball(page, d.id), middle);
    expect(stopped).toBeGreaterThan(contact - 4);
    expect(stopped).toBeLessThan(contact + 6);
    await fingers.lift(1);
  });

  test("the credits open and close with a finger, and fit a phone held sideways without scrolling", async ({ page }) => {
    const credits = page.getByRole("dialog", { name: "Credits" });
    await page.getByRole("button", { name: "Credits", exact: true }).tap();
    await expect(credits).toBeVisible();
    const fit = await credits.evaluate((dialog) => {
      const text = dialog.querySelector(".credits-text")!.getBoundingClientRect();
      const last = [...dialog.querySelectorAll("li")].pop()!.getBoundingClientRect();
      return { scrollable: dialog.scrollHeight - dialog.clientHeight, textTop: text.top, textBottom: text.bottom, lastBottom: last.bottom, innerHeight };
    });
    expect(fit.scrollable, "nothing to scroll to").toBeLessThanOrEqual(0);
    expect(fit.textTop).toBeGreaterThanOrEqual(0);
    expect(fit.lastBottom, "the last line is on screen").toBeLessThanOrEqual(fit.innerHeight);
    expect(fit.textBottom).toBeLessThanOrEqual(fit.innerHeight);

    // The x is a target a finger can find, and it closes the credits.
    const close = credits.getByRole("button", { name: "Close" });
    const box = (await close.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44 - 0.05); // (see the rounding note in the test of the corner controls' sizes)
    await close.tap();
    await expect(credits).toBeHidden();
  });

  test("in a window shorter than the credits, a finger scrolls them to the last line, and a tap outside the text closes them", async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 200 }); // an iPhone SE held sideways with its toolbars out, or a window a phone's keyboard has shrunk
    const fingers = await Fingers.on(page);
    const credits = page.getByRole("dialog", { name: "Credits" });
    await page.getByRole("button", { name: "Credits", exact: true }).tap();
    await expect(credits).toBeVisible();
    const state = () =>
      credits.evaluate((dialog) => ({
        top: dialog.scrollTop,
        room: dialog.scrollHeight - dialog.clientHeight,
        lastBottom: [...dialog.querySelectorAll("li")].pop()!.getBoundingClientRect().bottom,
        innerHeight,
        pageScrolled: [window.scrollX, window.scrollY],
      }));
    const before = await state();
    expect(before.room, "the text is taller than this window, so there is something to scroll to").toBeGreaterThan(0);
    expect(before.lastBottom, "and the last line starts out of sight").toBeGreaterThan(before.innerHeight);

    // Swipe up on the text until it has run out, as a finger would. A scroll carries on for a moment after the finger has gone, so each
    // time the place it has got to is read once it has stopped changing.
    const settled = async () => {
      let top = -1;
      for (let again = (await state()).top; again !== top; again = (await state()).top) {
        top = again;
        await page.waitForTimeout(60);
      }
      return top;
    };
    for (let swipe = 0; swipe < 6 && (await settled()) < before.room; swipe++) {
      await fingers.press(1, { x: 284, y: 170 });
      await fingers.move(1, { x: 284, y: 30 }, 8);
      await fingers.lift(1);
    }
    await settled();
    const after = await state();
    expect(after.top, "a finger scrolled the credits").toBeGreaterThan(0);
    expect(after.lastBottom, "all the way to the last line").toBeLessThanOrEqual(after.innerHeight);
    expect(after.pageScrolled, "and the page behind did not move").toEqual([0, 0]);

    // The dimmed toy around the text is where to tap to be rid of it.
    await page.touchscreen.tap(12, 100);
    await expect(credits).toBeHidden();
  });

  test("with ?tune, the two finger reach sliders move their numbers, leave the toy alone, and decide how far from a ball a finger can pick it up", async ({ page }) => {
    await page.goto("./?tune");
    await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
    const sliders: [key: string, label: string][] = [
      ["touchMinHitReachPx", "finger tap reach"],
      ["touchMinGrabReachPx", "finger grab reach"],
    ];
    for (const [key, label] of sliders) {
      const slider = page.getByLabel(label);
      await expect(slider, label).toBeVisible();
      const before = await sandbox<number>(page, `params.${key}`);
      expect(await slider.inputValue(), `${label} starts at the number in use`).toBe(String(before));
      const value = before === 40 ? 41 : 40;
      await slider.fill(String(value));
      expect(await sandbox<number>(page, `params.${key}`), `${label} moves ${key}`).toBe(value);
    }

    // Moving a slider must leave the toy alone: a rebuilt court would stop every ball in the air, and makes the name's layout afresh,
    // so a new layout is how to tell. (Checked in one step, so that no ball moves between.)
    const untouched = await page.evaluate(() => {
      const hook = (window as any).__sandbox;
      const layout = hook.layout();
      const balls = JSON.stringify(hook.balls());
      for (const input of document.querySelectorAll<HTMLInputElement>("input[type=range]")) {
        if (!input.parentElement!.textContent!.startsWith("finger")) continue;
        input.value = String(Number(input.value) === Number(input.max) ? Number(input.min) : Number(input.max));
        input.dispatchEvent(new Event("input"));
      }
      return { sameLayout: hook.layout() === layout, sameBalls: JSON.stringify(hook.balls()) === balls };
    });
    expect(untouched).toEqual({ sameLayout: true, sameBalls: true });

    // And the numbers matter: with the reaches raised to 60 and 50, a finger pressed 45 px from a ball (well outside the 22 px a finger
    // grabs from and the 32 px it hits from, by default) picks the ball up. The panel covers the left of the window, so it is the right-hand ball.
    await page.getByLabel("finger tap reach").fill("60");
    await page.getByLabel("finger grab reach").fill("50");
    const fingers = await Fingers.on(page);
    const d = await dot(page, 1);
    await fingers.press(1, { x: d.x, y: d.y + 45 });
    await expect.poll(async () => (await ball(page, d.id)).held, { timeout: 5000 }).toBe(true);
    await fingers.lift(1);
  });

  test("with ?tune, the panel of sliders scrolls under a finger, and the page behind it does not move", async ({ page }) => {
    await page.goto("./?tune");
    await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
    const panel = () =>
      page.evaluate(() => {
        const el = [...document.querySelectorAll("label")].find((l) => l.textContent!.startsWith("tap power"))!.parentElement!;
        const box = el.getBoundingClientRect();
        return { top: el.scrollTop, room: el.scrollHeight - el.clientHeight, box: { x: box.x, y: box.y, width: box.width, height: box.height }, innerHeight, pageScrolled: [window.scrollX, window.scrollY] };
      });
    const before = await panel();
    expect(before.room, "the panel is longer than the window is tall").toBeGreaterThan(0);
    expect(before.box.y + before.box.height, "and it ends inside the window, so its last slider can be got to").toBeLessThanOrEqual(before.innerHeight);

    const toy = JSON.stringify(await balls(page));
    const fingers = await Fingers.on(page);
    await fingers.press(1, { x: 40, y: before.box.y + before.box.height - 20 });
    await fingers.move(1, { x: 40, y: before.box.y + 20 }, 8);
    await fingers.lift(1);
    await expect.poll(async () => (await panel()).top).toBeGreaterThan(0);
    expect((await panel()).pageScrolled, "the page behind did not move").toEqual([0, 0]);
    expect(JSON.stringify(await balls(page)), "and a swipe on the panel is not a touch on the toy under it").toBe(toy);
  });
});

// ---- A phone held upright ----

test.describe("a phone held upright", () => {
  test("the rotate prompt shows below the row of buttons, with a phone icon, inside the window", async ({ page }) => {
    const note = page.locator(".rotate-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText(/sideways/);
    await expect(note.locator("svg")).toHaveCount(1);

    const { width, height } = size(page);
    const shown = await note.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el); // the icon and every line of the sentence
      const ink = range.getBoundingClientRect();
      const buttons = ["Credits", "Clear the balls", "Sound"].map((name) => document.querySelector(`[aria-label="${name}"]`)!.getBoundingClientRect().bottom);
      return { left: ink.left, right: ink.right, top: ink.top, bottom: ink.bottom, buttonsBottom: Math.max(...buttons), overflow: el.scrollWidth - el.clientWidth };
    });
    expect(shown.top, "below the row of buttons").toBeGreaterThanOrEqual(shown.buttonsBottom);
    expect(shown.left).toBeGreaterThanOrEqual(0);
    expect(shown.right).toBeLessThanOrEqual(width);
    expect(shown.bottom).toBeLessThanOrEqual(height);
    expect(shown.overflow, "nothing runs off the side").toBeLessThanOrEqual(0);
  });

  test("a tap goes through the prompt, and a finger still hits a ball while it shows", async ({ page }) => {
    const note = page.locator(".rotate-note");
    await expect(note).toBeVisible();
    expect(await note.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    // Whatever is at the middle of the prompt, a finger there reaches the toy.
    const box = (await note.boundingBox())!;
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2])).toBe("court");

    const d = await dot(page, 0);
    await page.touchscreen.tap(d.x, d.y + d.r * 0.8);
    expect((await lastHit(page))?.id).toBe(d.id);
  });

  test("the name is still on screen, in the middle, and the prompt does not cover it", async ({ page }) => {
    await expect(page.locator("h1")).toHaveText("quinn wai");
    const where = await whatIsWhere(page);
    expectNameOnScreen(where);
    expect(where.clearest.gap, `the air between the name or a ball and the ${where.clearest.name} button`).toBeGreaterThanOrEqual(8);
    const promptBottom = await page.locator(".rotate-note").evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().bottom;
    });
    expect(promptBottom, "the prompt ends above the name").toBeLessThan(where.inkBox.top);
  });

  test("turning the phone sideways takes the prompt away and fits the name to the new shape, and turning it back brings the prompt back", async ({ page }) => {
    const note = page.locator(".rotate-note");
    const { width, height } = size(page);
    const emPx = () => sandbox<number>(page, "layout().emPx");
    const upright = await emPx();
    await expect(note).toBeVisible();

    await page.setViewportSize({ width: height, height: width });
    await expect(note).toBeHidden();
    await expect.poll(emPx, { message: "the name is laid out again for the new window" }).toBeGreaterThan(upright * 1.3);
    const sideways = await whatIsWhere(page);
    expect([sideways.width, sideways.height]).toEqual([height, width]);
    expectNameOnScreen(sideways);

    await page.setViewportSize({ width, height });
    await expect(note).toBeVisible();
    await expect.poll(emPx).toBeCloseTo(upright, 1);
    expectNameOnScreen(await whatIsWhere(page));
  });

  test("with reduced motion asked for, the prompt's phone does not tip; otherwise it does", async ({ page }) => {
    const animation = () => page.locator(".rotate-note svg").evaluate((el) => getComputedStyle(el).animationName);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await animation()).not.toBe("none");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await animation()).toBe("none");
  });
});
