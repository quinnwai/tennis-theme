// QWW-100 (step 1 of QWW-99): the v7 can controls, written before the change by chief-keef. Drag moves and tap acts; a carried can follows
// the pointer on a spring and leans into sideways moves; let go, it settles under gravity and then stands fixed; a can is held up by the
// balls it leans on and falls first when one goes; a tap pours a can and puts it back where it stood. The spec is QWW-99's description
// ("The controls") and Quinn-Wai's controls spec in the prototype zip (design/v7/controls/tennis-can-controls-spec.md).
//
// What these checks ask of the test hook, window.__sandbox, beyond what main has (the prototype's hook has all of it):
// - cans()[i].state: "placed" (standing, fixed) | "held" | "settling" (falling after a let go) | "pour" | "wiggle"
// - balls()[i].propping: whether a standing can is leaning on that ball
// - addCan(x, y, balls = 3, degrees = 0): put a can on the court at a point on the page (px), turned `degrees` clockwise; gives its id
// Positions are page px, y down; cans()[i].angle stays in radians clockwise, as on main.
//
// The v6 can checks in bench-bag.spec.ts, bench-bag.phone.spec.ts and src/cans.test.ts that this replaces (a can carried on a joint, tipped
// or shaken to pour) are the builder's to retire, each named in the PR. Nothing here may be weakened to pass; a check that is wrong is
// argued on QWW-100.

import { freeze, run, until, drag } from "./frozen";
import { expect, type Page } from "@playwright/test";
import { test } from "./test";

type CanState = "placed" | "held" | "settling" | "pour" | "wiggle";
interface Can {
  id: number;
  x: number;
  y: number;
  angle: number;
  held: boolean;
  ballsLeft: number;
  width: number;
  height: number;
  state: CanState;
}
interface Ball {
  id: number;
  pinned: boolean;
  held: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  propping: boolean;
}
interface Pt {
  x: number;
  y: number;
}

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const cans = (page: Page) => sandbox<Can[]>(page, "cans()");
const can = async (page: Page, id: number) => (await cans(page)).find((c) => c.id === id)!;
const balls = (page: Page) => sandbox<Ball[]>(page, "balls()");
const addCan = (page: Page, x: number, y: number, n = 3, degrees = 0) => sandbox<number>(page, `addCan(${x}, ${y}, ${n}, ${degrees})`);
const deg = (radians: number) => (radians * 180) / Math.PI;
const scene = (page: Page) => sandbox<{ height: number; width: number; benchX: number; benchSurfaceY: number }>(page, "scene()");

/** The floor as the page draws it: the window's bottom, lifted on a touch screen. */
async function floorY(page: Page) {
  const lift = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? (window as any).__sandbox.params.floorLiftPx : 0));
  return (await scene(page)).height - lift;
}

/** A can standing still on the open floor left of the name, clear of everything. */
async function standingCan(page: Page, x = 100): Promise<Can> {
  const floor = await floorY(page);
  const id = await addCan(page, x, floor - 200);
  return until(page, () => can(page, id), (c) => c.state === "placed", "the new can comes to stand on the floor", 4);
}

/** A tap, timed by the court's clock: down, a tenth of a second, up, without moving. */
async function tap(page: Page, at: Pt) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await run(page, 0.1);
  await page.mouse.up();
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

test.describe("v7 can controls", () => {
  test("a tap on a can pours every ball out and puts the can back where it stood; tapped again, empty, it wiggles and stays", async ({ page }) => {
    const c0 = await standingCan(page);
    const before = (await balls(page)).length;
    await tap(page, { x: c0.x, y: c0.y });
    const seen = new Set<CanState>();
    const done = await until(
      page,
      async () => {
        const c = await can(page, c0.id);
        seen.add(c.state);
        return c;
      },
      (c) => c.ballsLeft === 0 && c.state === "placed",
      "the can pours and goes back",
      6,
    );
    expect(seen.has("pour"), "it poured").toBe(true);
    expect((await balls(page)).length - before, "all three balls are on the court").toBe(3);
    expect(Math.hypot(done.x - c0.x, done.y - c0.y), "back where it stood (px)").toBeLessThan(2);
    expect(Math.abs(deg(done.angle - c0.angle)), "at the angle it stood at (degrees)").toBeLessThan(1);

    seen.clear();
    await tap(page, { x: c0.x, y: c0.y });
    const after = await until(
      page,
      async () => {
        const c = await can(page, c0.id);
        seen.add(c.state);
        return c;
      },
      (c) => seen.has("wiggle") && c.state === "placed",
      "the empty can wiggles and settles",
      3,
    );
    expect(seen.has("pour"), "an empty can does not pour").toBe(false);
    expect(Math.hypot(after.x - c0.x, after.y - c0.y)).toBeLessThan(2);
  });

  test("a carried can follows the pointer and leans into sideways moves, no more than about 17 degrees; let go, it settles and then stands fixed", async ({ page }) => {
    test.slow();
    const c0 = await standingCan(page);
    const start = { x: c0.x, y: c0.y };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const up = { x: start.x + 20, y: start.y - 120 };
    await drag(page, start, up, 10);
    expect((await can(page, c0.id)).state, "a press that moves is a carry").toBe("held");
    // swing it from side to side, fast, and watch how far it leans
    let lean = 0;
    let at = up;
    for (const dx of [160, -160, 160, -160]) {
      const to = { x: up.x + dx / 2, y: up.y };
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(at.x + ((to.x - at.x) * i) / 6, at.y);
        await run(page, 1 / 60);
        lean = Math.max(lean, Math.abs(deg((await can(page, c0.id)).angle)));
      }
      at = to;
    }
    expect(lean, "it leans into the moves").toBeGreaterThan(3);
    expect(lean, "but no more than about 17 degrees").toBeLessThanOrEqual(18);
    // hold still, then let go: it follows to the pointer, then falls and stands
    await drag(page, at, up, 6);
    await run(page, 1);
    const held = await can(page, c0.id);
    expect(Math.hypot(held.x - up.x, held.y - up.y), "it hangs at the pointer, within a can's height").toBeLessThan(held.height);
    await page.mouse.up();
    const seen = new Set<CanState>();
    const rest = await until(
      page,
      async () => {
        const c = await can(page, c0.id);
        seen.add(c.state);
        return c;
      },
      (c) => c.state === "placed",
      "the let-go can settles",
      4,
    );
    expect(seen.has("settling"), "it falls before it stands").toBe(true);
    expect(Math.abs(deg(rest.angle)), "standing upright on the open floor").toBeLessThan(2);
    // fixed: a ball dropped on it and two more seconds do not move it
    await sandbox(page, `drop(${rest.x}, ${rest.y - rest.height})`);
    await run(page, 2);
    const later = await can(page, c0.id);
    expect(later.state).toBe("placed");
    expect(Math.hypot(later.x - rest.x, later.y - rest.y), "it has not moved (px)").toBeLessThan(0.5);
  });

  test("a falling can is caught by a drag, and a tap on a falling can does nothing", async ({ page }) => {
    const floor = await floorY(page);
    // 400 px up, or as high as the window allows when it is shorter (a phone held sideways): the can has to be on the page to be pressed
    const high = Math.max(floor - 400, 70);
    const tapped = await addCan(page, 100, high);
    await run(page, 0.05);
    const t0 = await can(page, tapped);
    expect(t0.state).toBe("settling");
    await tap(page, { x: t0.x, y: t0.y + 10 });
    const t1 = await can(page, tapped);
    expect(t1.state === "settling" || t1.state === "placed", "a tap does not pour or take it").toBe(true);
    expect(t1.ballsLeft).toBe(3);

    const caught = await addCan(page, 240, high);
    await run(page, 0.05);
    const c0 = await can(page, caught);
    await page.mouse.move(c0.x, c0.y);
    await page.mouse.down();
    await drag(page, { x: c0.x, y: c0.y }, { x: c0.x + 30, y: c0.y - 20 }, 4);
    expect((await can(page, caught)).state, "a drag catches it").toBe("held");
    await page.mouse.up();
  });

  test("a can leaning on a ball falls when the ball is dragged away, before the ball moves", async ({ page }) => {
    test.slow();
    const L = await scene(page);
    // 200 px along the bench; on a phone the bag's end is nearer, and the can would land against it and not against the ball
    const bx = L.benchX + (L.width > 1200 ? 200 : 100);
    await sandbox(page, `drop(${bx}, ${L.benchSurfaceY - 30})`);
    await run(page, 5);
    const ball0 = (await balls(page)).filter((b) => !b.pinned).sort((a, b) => Math.abs(a.x - bx) - Math.abs(b.x - bx))[0];
    const ppm = await sandbox<number>(page, "pxPerMeter()");
    const id = await addCan(page, ball0.x - (0.079 * ppm) / 2 - ball0.r - 6, L.benchSurfaceY - 0.15 * ppm);
    const c0 = await until(page, () => can(page, id), (c) => c.state === "placed", "the can comes to lean on the ball", 4);
    expect((await balls(page)).find((b) => b.id === ball0.id)!.propping, "the ball holds the can up").toBe(true);
    expect(Math.abs(deg(c0.angle)), "it leans").toBeGreaterThan(3);

    await page.mouse.move(ball0.x, ball0.y);
    await page.mouse.down();
    let fellFirst: boolean | null = null;
    for (let i = 1; i <= 12 && fellFirst === null; i++) {
      await page.mouse.move(ball0.x + i * 12, ball0.y - i * 3);
      await run(page, 1 / 60);
      const b = (await balls(page)).find((x) => x.id === ball0.id)!;
      if (Math.hypot(b.x - ball0.x, b.y - ball0.y) > 1) fellFirst = (await can(page, id)).state !== "placed";
    }
    await page.mouse.up();
    expect(fellFirst, "by the frame the ball first moves, the can is already falling").toBe(true);
    await run(page, 3);
    const c1 = await can(page, id);
    expect(c1.state).toBe("placed");
    expect(Math.hypot(c1.x - c0.x, c1.y - c0.y), "it came down").toBeGreaterThan(5);
  });
});

test.describe("v7 can controls: a carried can passes through balls", () => {
  // Found by the QWW-101 accuracy run at 750 x 280: a can carried low across the floor pushed a resting ball down through the (lifted)
  // floor, and the ball fell forever. A carried can passes through things (QWW-99, "Carry a can"), so it must not move a ball at all.
  test("a can carried low across the floor, over a resting ball, leaves the ball where it was and on the court", async ({ page }) => {
    test.slow();
    const { width } = page.viewportSize()!;
    const floor = await floorY(page);
    await sandbox(page, `drop(${width / 2}, ${floor - 60})`);
    await run(page, 3);
    const ball0 = (await balls(page)).filter((b) => !b.pinned).sort((a, b) => Math.abs(a.x - width / 2) - Math.abs(b.x - width / 2))[0];
    const c0 = await standingCan(page, width - 100);
    await page.mouse.move(c0.x, c0.y);
    await page.mouse.down();
    const low = { x: 100, y: c0.y };
    await drag(page, { x: c0.x, y: c0.y }, low, 40);
    const ball1 = (await balls(page)).find((b) => b.id === ball0.id)!;
    expect(ball1.y, "the ball is still on the court, not through the floor").toBeLessThan(floor);
    expect(Math.hypot(ball1.x - ball0.x, ball1.y - ball0.y), "and the carried can did not move it (px)").toBeLessThan(2);
    await page.mouse.up();
    await run(page, 2);
    for (const b of await balls(page)) expect(b.y, `ball ${b.id} is above the floor`).toBeLessThan(floor);
  });
});

test.describe("v7 cans in the bag", () => {
  /** Unzip the bag with the keyboard, and let what is in it come up. */
  async function openBag(page: Page) {
    await page.focus(".v6-pull");
    await page.keyboard.press("Enter");
    await until(page, () => sandbox<{ open: boolean }>(page, "bag()"), (b) => b.open, "the bag opens", 3);
    await run(page, 1.3);
    // what rises out of the bag is a page animation, which the court's clock does not run: wait for it to end, or the box measured below is a can still on its way up
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)).then(() => undefined));
  }
  const itemBox = (page: Page, i: number) =>
    page.evaluate((i) => {
      const r = document.querySelectorAll(".v6-rise")[i].getBoundingClientRect();
      return { x: r.left + r.width / 2, top: r.top, width: r.width, height: r.height };
    }, i);

  test("a tap on a can in the open bag lifts it clear, pours its three balls and puts it back into its place", async ({ page }) => {
    await openBag(page);
    const box0 = await itemBox(page, 1);
    const before = (await balls(page)).length;
    await tap(page, { x: box0.x, y: box0.top + 8 });
    await until(page, () => balls(page), (b) => b.length - before >= 3, "its three balls come out", 6);
    await until(page, () => cans(page), (cs) => cs.every((c) => c.state === "placed"), "the can is back and still", 6);
    await run(page, 1);
    const box1 = await itemBox(page, 1);
    expect(Math.abs(box1.x - box0.x), "back in its place across (px)").toBeLessThan(2);
    expect(Math.abs(box1.top - box0.top), "and down (px)").toBeLessThan(2);
  });

  test("at 1280 x 800, the right-hand can pulled out of the open bag and over the name follows the hand and does not jam under the w", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "the jam was seen at 1280 x 800 on a desktop");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
    await openBag(page);
    const box = await itemBox(page, 2);
    const from = { x: box.x, y: box.top + 8 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const layout = await sandbox<{ letters: { char: string; loops: Pt[][] }[] }>(page, "layout()");
    const w = layout.letters.find((l) => l.char === "w")!.loops.flat();
    const over = { x: w.reduce((s, p) => s + p.x, 0) / w.length, y: Math.min(...w.map((p) => p.y)) - 120 };
    await drag(page, from, over, 40);
    await run(page, 1);
    const held = (await cans(page)).find((c) => c.held)!;
    expect(held, "the can is in the hand").toBeTruthy();
    expect(Math.hypot(held.x - over.x, held.y - over.y), "and with it, above the w, not caught under it").toBeLessThan(held.height);
    await page.mouse.up();
    await until(page, () => cans(page), (cs) => cs.every((c) => c.state === "placed"), "it lands and stands", 4);
  });
});

test.describe("v7 can controls by touch", () => {
  test("one finger carries a can while another throws a ball", async ({ page }, info) => {
    test.skip(!info.project.use.hasTouch, "a touch screen only");
    const c0 = await standingCan(page);
    const loose = (await balls(page)).find((b) => b.pinned)!; // a dot: the finger takes it off the "i"
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, pts: Pt[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
    await touch("touchStart", [{ x: c0.x, y: c0.y }]);
    for (let i = 1; i <= 4; i++) {
      await touch("touchMove", [{ x: c0.x + i * 6, y: c0.y - i * 12 }]);
      await run(page, 1 / 60);
    }
    const hand = { x: c0.x + 24, y: c0.y - 48 };
    await touch("touchStart", [hand, { x: loose.x, y: loose.y }]);
    await run(page, 1 / 60);
    let both = false;
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", [hand, { x: loose.x + i * 14, y: loose.y - i * 10 }]);
      await run(page, 1 / 60);
      const c = await can(page, c0.id);
      const b = (await balls(page)).find((x) => x.id === loose.id)!;
      both ||= c.held && b.held;
    }
    expect(both, "the can and the ball are held at once").toBe(true);
    await touch("touchEnd", []);
    await run(page, 0.5);
    const thrown = (await balls(page)).find((x) => x.id === loose.id)!;
    expect(thrown.held).toBe(false);
    await until(page, () => can(page, c0.id), (c) => c.state === "placed", "the can is let go and stands", 4);
  });

  test("a finger tap pours a can", async ({ page }, info) => {
    test.skip(!info.project.use.hasTouch, "a touch screen only");
    const c0 = await standingCan(page);
    await page.touchscreen.tap(c0.x, c0.y);
    await until(page, () => can(page, c0.id), (c) => c.ballsLeft === 0 && c.state === "placed", "the tapped can pours and goes back", 6);
  });
});
