// QWW-102 (step 3 of QWW-99): the game is found by emptying a can, and balls sunk from a distance score. Written before the change by
// chief-keef, following the prototype's checks/check-score.mjs. The rule itself is unit-tested in src/scoring.test.ts.
//
// What these checks ask of the test hook, window.__sandbox, beyond what steps 1 and 2 added (the prototype's hook has all of it):
// - remove(id): take a ball off the court (the checks sweep loose balls away so a throw finds the mouth clear)
// - launch(x, y, vx, vy): throw a ball from a point on the page, as a hand would (page px and px/s, y down); gives its id
// - game(): { found, you, them, championshipPoint, lastEntry, heard }: whether the game is found; the two calls on the board ("15",
//   "30", "40"); whether it is championship point; how the last ball into a can was judged ("point", "too close", "dropped" ...); and
//   the names of the crowd sounds the page has started, which stays empty with the sound off
// Nothing here may be weakened to pass; a check that is wrong is argued on QWW-102. Winning the match is step 4.

import { freeze, run, until, drag } from "./frozen";
import { expect, type Page } from "@playwright/test";
import { test } from "./test";

interface Can {
  id: number;
  x: number;
  y: number;
  angle: number;
  held: boolean;
  ballsLeft: number;
  height: number;
  state: string;
}
interface Game {
  found: boolean;
  you: string;
  them: string;
  championshipPoint: boolean;
  lastEntry: string | null;
  heard: string[];
}
interface Pt {
  x: number;
  y: number;
}

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const cans = (page: Page) => sandbox<Can[]>(page, "cans()");
const can = async (page: Page, id: number) => (await cans(page)).find((c) => c.id === id)!;
const game = (page: Page) => sandbox<Game>(page, "game()");
const addCan = (page: Page, x: number, y: number, balls = 3) => sandbox<number>(page, `addCan(${x}, ${y}, ${balls})`);
const board = (page: Page) => page.getByText(/nadal/i).first();

/** Where a can's mouth is: the middle of its top end (page px). */
const mouthOf = (c: Can): Pt => ({ x: c.x + Math.sin(c.angle) * (c.height / 2), y: c.y - Math.cos(c.angle) * (c.height / 2) });

/** A throw from `from` that comes down onto `mouth` about `t` s later, as the court flies it (gravity and air drag), page px/s. */
function aim(ppm: number, from: Pt, mouth: Pt, t: number) {
  const r = 0.0335 * ppm;
  const crossX = (vx: number, vy: number, y: number) => {
    const dt = 1 / 240;
    const g = 9.81 * ppm;
    let [px, py, ux, uy] = [from.x, from.y, vx, vy];
    for (let i = 0; i < 2400; i++) {
      const speed = Math.hypot(ux, uy) / ppm;
      if (speed > 0.5) {
        const keep = Math.max(0, 1 - 0.0206 * speed * dt);
        ux *= keep;
        uy *= keep;
      }
      uy += g * dt;
      const [nx, ny] = [px + ux * dt, py + uy * dt];
      if (uy > 0 && py <= y && ny >= y) return px + ((nx - px) * (y - py)) / (ny - py);
      [px, py] = [nx, ny];
    }
    return null;
  };
  const vx = (mouth.x - from.x) / t;
  let [lo, hi] = [-12000, 12000];
  for (let i = 0; i < 80; i++) {
    const vy = (lo + hi) / 2;
    const x = crossX(vx, vy, mouth.y - r);
    const past = x === null ? false : vx < 0 ? x < mouth.x : x > mouth.x;
    if (x === null || past) lo = vy;
    else hi = vy;
  }
  return { vx, vy: (lo + hi) / 2 };
}

/** Throw a ball from `from` into the mouth of can `id`; true if it went in. */
async function shoot(page: Page, id: number, from: Pt, t = 0.6) {
  const ppm = await sandbox<number>(page, "pxPerMeter()");
  const c = await can(page, id);
  const v = aim(ppm, from, mouthOf(c), t);
  const before = c.ballsLeft;
  await sandbox(page, `launch(${from.x}, ${from.y}, ${v.vx}, ${v.vy})`);
  await run(page, 2.5);
  return (await can(page, id)).ballsLeft > before;
}

/** A tap, timed by the court's clock. */
async function tap(page: Page, at: Pt) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await run(page, 0.1);
  await page.mouse.up();
}

async function floorY(page: Page) {
  const lift = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? (window as any).__sandbox.params.floorLiftPx : 0));
  return page.viewportSize()!.height - lift;
}

/** An empty can standing on the floor at `x`: put down full, then tapped so it pours (which finds the game). */
async function emptyCan(page: Page, x: number) {
  const id = await addCan(page, x, (await floorY(page)) - 200);
  const c = await until(page, () => can(page, id), (c) => c.state === "placed", "the can stands", 4);
  await tap(page, { x: c.x, y: c.y });
  await until(page, () => can(page, id), (c) => c.ballsLeft === 0 && c.state === "placed", "it pours and goes back", 6);
  return id;
}

/** Sweep every loose ball off, so a throw finds the can's mouth clear. */
const tidy = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__sandbox;
    for (const b of s.balls()) if (!b.pinned && !b.held) s.remove(b.id);
  });

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (e) => seen.push(String(e)));
  await page.addInitScript(() => localStorage.setItem("site:sound", "on"));
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  await freeze(page);
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page), "the page raised no errors").toEqual([]);
});

test.describe("finding the game", () => {
  test("nothing on the page mentions a game until a can is emptied; then the board drops in at 15-30, you against Nadal", async ({ page }) => {
    expect((await game(page)).found).toBe(false);
    await expect(board(page)).toBeHidden();
    // a can that pours only part of its balls is not yet empty: carry one about and set it down; still nothing
    const id = await addCan(page, 120, (await floorY(page)) - 200);
    await until(page, () => can(page, id), (c) => c.state === "placed", "the can stands", 4);
    await run(page, 1);
    expect((await game(page)).found).toBe(false);
    await emptyCan(page, 260);
    const g = await game(page);
    expect(g.found).toBe(true);
    expect([g.you, g.them]).toEqual(["15", "30"]);
    await expect(board(page)).toBeVisible();
    const box = (await board(page).boundingBox())!;
    const { width, height } = page.viewportSize()!;
    expect(box.x + box.width / 2, "at the top left").toBeLessThan(width / 2);
    expect(box.y + box.height / 2).toBeLessThan(height / 2);
  });
});

test.describe("points", () => {
  test("a throw from a third of the width away scores: applause, the board moves on, and no +1; from a tenth it is too close", async ({ page }) => {
    const { width } = page.viewportSize()!;
    const id = await emptyCan(page, 120);
    await tidy(page);
    const m = mouthOf(await can(page, id));
    const heardBefore = (await game(page)).heard.length;
    expect(await shoot(page, id, { x: m.x + width / 3, y: 40 }), "the ball goes in").toBe(true);
    let g = await game(page);
    expect(g.lastEntry).toBe("point");
    expect([g.you, g.them]).toEqual(["30", "30"]);
    expect(g.heard.slice(heardBefore), "applause").toContain("applause");
    await expect(page.getByText("+1")).toHaveCount(0);

    await tidy(page);
    expect(await shoot(page, id, { x: m.x + width / 10, y: m.y - 40 }, 0.4), "the ball goes in").toBe(true);
    g = await game(page);
    expect(g.lastEntry).toBe("too close");
    expect([g.you, g.them], "no point").toEqual(["30", "30"]);
  });

  test("two points make it 40-30, CHAMPIONSHIP POINT; the match is not won yet", async ({ page }) => {
    const { width } = page.viewportSize()!;
    const id = await emptyCan(page, 120);
    for (let i = 0; i < 2; i++) {
      await tidy(page);
      // empty it again if the last ball stayed in, so there is room
      if ((await can(page, id)).ballsLeft >= 3) await tap(page, await can(page, id));
      const m = mouthOf(await can(page, id));
      expect(await shoot(page, id, { x: m.x + width / 3, y: 40 })).toBe(true);
    }
    const g = await game(page);
    expect([g.you, g.them]).toEqual(["40", "30"]);
    expect(g.championshipPoint).toBe(true);
    await expect(page.getByText(/championship point/i)).toBeVisible();
  });

  test("a ball caught in a carried can scores", async ({ page }) => {
    const { width, height } = page.viewportSize()!;
    const id = await emptyCan(page, 120);
    await tidy(page);
    const c = await can(page, id);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    const hold = { x: 140, y: height * 0.6 };
    await drag(page, { x: c.x, y: c.y }, hold, 8);
    await run(page, 1.5); // still in the hand, and still
    const held = await can(page, id);
    expect(held.held).toBe(true);
    const m = mouthOf(held);
    const before = held.ballsLeft;
    const ppm = await sandbox<number>(page, "pxPerMeter()");
    const v = aim(ppm, { x: m.x + width / 3, y: 40 }, m, 0.6);
    await sandbox(page, `launch(${m.x + width / 3}, 40, ${v.vx}, ${v.vy})`);
    await run(page, 2);
    expect((await can(page, id)).ballsLeft, "caught").toBe(before + 1);
    const g = await game(page);
    expect(g.lastEntry).toBe("point");
    expect([g.you, g.them]).toEqual(["30", "30"]);
    await page.mouse.up();
  });

  test("a ball into a can that was poured standing in the open bag scores", async ({ page }) => {
    const { width } = page.viewportSize()!;
    await page.focus(".v6-pull");
    await page.keyboard.press("Enter");
    await until(page, () => sandbox<{ open: boolean }>(page, "bag()"), (b) => b.open, "the bag opens", 3);
    await run(page, 1.3);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)).then(() => undefined));
    const box = await page.evaluate(() => {
      const r = document.querySelectorAll(".v6-rise")[0].getBoundingClientRect();
      return { x: r.left + r.width / 2, top: r.top };
    });
    await tap(page, { x: box.x, y: box.top + 8 });
    await run(page, 6); // it pours, which finds the game, and goes back into its place
    expect((await game(page)).found).toBe(true);
    await tidy(page);
    const mouth = { x: box.x, y: box.top };
    const ppm = await sandbox<number>(page, "pxPerMeter()");
    const from = { x: Math.max(30, mouth.x - width / 3), y: 40 };
    const v = aim(ppm, from, mouth, 0.6);
    await sandbox(page, `launch(${from.x}, ${from.y}, ${v.vx}, ${v.vy})`);
    await run(page, 2.5);
    const g = await game(page);
    expect(g.lastEntry).toBe("point");
    expect([g.you, g.them]).toEqual(["30", "30"]);
  });
});

test.describe("the applause", () => {
  test("with the sound off, a point still moves the board but starts no sound", async ({ page }) => {
    await page.getByRole("button", { name: /^Sound/ }).click();
    await expect(page.getByRole("button", { name: /^Sound/ })).toHaveAttribute("aria-label", "Sound: off");
    const { width } = page.viewportSize()!;
    const id = await emptyCan(page, 120);
    await tidy(page);
    const m = mouthOf(await can(page, id));
    expect(await shoot(page, id, { x: m.x + width / 3, y: 40 })).toBe(true);
    const g = await game(page);
    expect([g.you, g.them]).toEqual(["30", "30"]);
    expect(g.heard).toEqual([]);
  });

  test("is credited in the credits", async ({ page }) => {
    await page.getByRole("button", { name: "Credits", exact: true }).click();
    const credits = page.getByRole("dialog", { name: "Credits" });
    await expect(credits).toContainText(/applause/i);
    await expect(credits).toContainText(/cognito perceptu/i);
  });
});
