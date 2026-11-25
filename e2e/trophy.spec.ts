// QWW-105 (step 6 of QWW-99): the trophy becomes a thing in the court. Written before the change by chief-keef. It floats and bobs until
// touched; then it is carried on a slower spring than a can (pull 0.12 against 0.2), leans at most 3 degrees, shows a drop shadow in its
// own shape, and stands where it lands. A can can stand in its cup (the trophy stops bobbing under it, and the can falls when the trophy is
// carried off). Its outline runs the bowl's sides straight down to the base (TROPHY_HULL), so no ball wedges beside the stem. A ball going
// into the cup is drawn hidden below the front of the rim (TROPHY_LIP), then it is gone, and it scores by the same rule as a can. A later
// win keeps the trophy exactly where and how it stands, set down or tilted, and glints on its rim turned with it. The prototype's
// checks/check-again.mjs (set-down and Restart cases) and checks/check-trophy.mjs are the models; the tilted case is new.
//
// What these checks ask of the test hook, window.__sandbox, beyond what step 5 added:
// - game().trophy gains: `state` ("floating" | "held" | "settling" | "placed"), with `floating` true only while it is "floating";
//   `mouth`: { x, y, half }, the middle of the rim (page px) and how far it opens either side (px), turned with it. `angle` is its real
//   turn now (radians clockwise), no longer always 0.
// - trophyRest(): where the carried trophy would come to rest if let go now, { x, y, angle } (its foot, page px; radians clockwise), or
//   null when it is not carried
// - ghosts(): while the trophy is carried, one more shadow, { id: "trophy", x, y, angle, alpha, width, height }: its foot, turn and fade
//   as rest(id)'s are for a can, and its size as drawn (px): the picture's, handles and all, not the box it settles as
// - trophyHull(): the solid outline balls meet, as the court has it now (page px points, turned and placed): TROPHY_HULL
// - balls(): each ball gains `behindLip`: true while it is drawn going into the cup, hidden below the front of the rim
// In a frozen court (QWW-95) all of it runs on the court's clock. Nothing here may be weakened to pass; a check that is wrong is argued on
// QWW-105.

import { freeze, run, until, drag, drawn } from "./frozen";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { test } from "./test";

interface Pt {
  x: number;
  y: number;
}
interface Pose extends Pt {
  angle: number;
}
interface Trophy extends Pose {
  width: number;
  height: number;
  floating: boolean;
  state: string;
  mouth: Pt & { half: number };
}
interface LogEntry {
  event: string;
  t: number;
  x?: number;
  y?: number;
}
interface Game {
  found: boolean;
  won: boolean;
  log: LogEntry[];
  trophy: Trophy | null;
}
interface Ball extends Pt {
  id: number;
  r: number;
  vx: number;
  vy: number;
  pinned: boolean;
  held: boolean;
  behindLip: boolean;
}
interface Can extends Pose {
  id: number;
  height: number;
  width: number;
  state: string;
  held: boolean;
  ballsLeft: number;
}
interface Ghost extends Pose {
  id: number | string;
  alpha: number;
  width?: number;
  height?: number;
}

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const game = (page: Page) => sandbox<Game>(page, "game()");
const trophy = async (page: Page) => (await game(page)).trophy!;
const balls = (page: Page) => sandbox<Ball[]>(page, "balls()");
const cans = (page: Page) => sandbox<Can[]>(page, "cans()");
const can = async (page: Page, id: number) => (await cans(page)).find((c) => c.id === id)!;
const playAgain = (page: Page) => page.getByRole("button", { name: "Play again" });
const restart = (page: Page) => page.getByRole("button", { name: "Clear the balls" });
const deg = (radians: number) => (radians * 180) / Math.PI;
const when = (log: LogEntry[], event: string) => log.find((e) => e.event === event);

async function floorY(page: Page) {
  const lift = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? (window as any).__sandbox.params.floorLiftPx : 0));
  return page.viewportSize()!.height - lift;
}

/** Where to put things down on the floor, clear of the bench and the bag: the prototype's spot, left of the bench. */
async function clearFloorX(page: Page) {
  const scene = await sandbox<{ benchX: number }>(page, "scene()");
  return Math.max(60, Math.min(150, scene.benchX - 140));
}

async function tap(page: Page, at: Pt) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await run(page, 0.1);
  await page.mouse.up();
}

/** Find the game: a full can put down near the bench and tapped, so it pours. Gives the can's id. */
async function findGame(page: Page) {
  const id = await sandbox<number>(page, `addCan(120, ${(await floorY(page)) - 200}, 3)`);
  const c = await until(page, () => can(page, id), (c) => c.state === "placed", "the can stands", 4);
  await tap(page, c);
  await until(page, () => game(page), (g) => g.found, "the game is found", 6);
  return id;
}

/** Win the match by the hook and run the court until the stats are down. Gives this win's log entries. */
async function win(page: Page) {
  const from = (await game(page)).log.length;
  for (let i = 0; i < 3; i++) await sandbox(page, "scorePoint()");
  // Looked at every quarter second: what the tests check is the log's own times, and frame-by-frame looks made a test of three wins
  // outlast its 30 s (QWW-99).
  const g = await until(page, () => game(page), (g) => g.log.slice(from).some((e) => e.event === "stats"), "the stats come down", 20, 0.25);
  return g.log.slice(from);
}

/** The first win: the game found and won, and the trophy floating above the name. */
async function wonTrophy(page: Page) {
  await findGame(page);
  const log = await win(page);
  expect((await trophy(page)).state).toBe("floating");
  // the balls the can poured are in the way of everything the tests set down: sweep them off, as the "whole match" test does
  await page.evaluate(() => {
    const s = (window as any).__sandbox;
    for (const b of s.balls()) if (!b.pinned && !b.held) s.remove(b.id);
    for (const c of s.cans()) s.removeCan(c.id); // and the can that was tapped, which stands where the tests set the trophy down
  });
  return log;
}

/** px per mm of the trophy as drawn (its picture is 387 mm tall). */
const perMm = (t: Trophy) => t.height / 387;

/** A point on the trophy's base to press it by (its base is -78 to 136 mm across from the foot, 0 to 94 mm up), turned with it. */
function grabPoint(t: Trophy, acrossMm = 28.7, upMm = 60): Pt {
  const k = perMm(t);
  const [dx, dy] = [acrossMm * k, -upMm * k];
  return { x: t.x + dx * Math.cos(t.angle) - dy * Math.sin(t.angle), y: t.y + dx * Math.sin(t.angle) + dy * Math.cos(t.angle) };
}

/** Carry the trophy by its base so that its foot is over `foot`, hold still, and let go; gives where the court said it would rest. */
async function carryTo(page: Page, foot: Pt, acrossMm = 28.7) {
  const t = await trophy(page);
  const from = grabPoint(t, acrossMm);
  const to = { x: foot.x + (from.x - t.x), y: foot.y + (from.y - t.y) };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await drag(page, from, to, 30);
  await run(page, 1.8);
  const said = await sandbox<Pose | null>(page, "trophyRest()");
  expect(said, "the court says where it will rest while it is carried").not.toBeNull();
  await page.mouse.up();
  await until(page, () => trophy(page), (t) => t.state === "placed", "it lands and stands", 5);
  return said!;
}

/** Set the trophy down on the floor, clear of everything. */
async function setDown(page: Page) {
  const t = await trophy(page);
  const x = await clearFloorX(page);
  await carryTo(page, { x, y: (await floorY(page)) - t.height * 0.6 });
  return trophy(page);
}

/** The glint's offset from the trophy's foot, turned back by the trophy's angle: the same on every win (px). */
function glintOffset(glint: LogEntry, t: Trophy): Pt {
  const [dx, dy] = [glint.x! - t.x, glint.y! - t.y];
  return { x: dx * Math.cos(-t.angle) - dy * Math.sin(-t.angle), y: dx * Math.sin(-t.angle) + dy * Math.cos(-t.angle) };
}

/** How far a point is from a polygon's edges, and whether it is inside. */
function fromPolygon(p: Pt, poly: Pt[]) {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[j], poly[i]];
    const [ex, ey] = [b.x - a.x, b.y - a.y];
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, Math.hypot(p.x - a.x - u * ex, p.y - a.y - u * ey));
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return { d, inside };
}

/** A throw from `from` that comes down through the point `m` (page px): the same ballistic aim as e2e/match.spec.ts, in the page. */
async function aim(page: Page, from: Pt, m: Pt) {
  const ppm = await sandbox<number>(page, "pxPerMeter()");
  return page.evaluate(
    ([ppm, from, m]) => {
      const t = 0.6;
      const vx = (m.x - from.x) / t;
      const r = 0.0335 * ppm;
      const cross = (vy: number) => {
        let [px, py, ux, uy] = [from.x, from.y, vx, vy];
        for (let i = 0; i < 2400; i++) {
          const s = Math.hypot(ux, uy) / ppm;
          if (s > 0.5) {
            const k = Math.max(0, 1 - 0.0206 * s * (1 / 240));
            ux *= k;
            uy *= k;
          }
          uy += 9.81 * ppm * (1 / 240);
          const [nx, ny] = [px + ux / 240, py + uy / 240];
          if (uy > 0 && py <= m.y - r && ny >= m.y - r) return px + ((nx - px) * (m.y - r - py)) / (ny - py);
          [px, py] = [nx, ny];
        }
        return null;
      };
      let [lo, hi] = [-12000, 12000];
      for (let i = 0; i < 80; i++) {
        const vy = (lo + hi) / 2;
        const x = cross(vy);
        const past = x === null ? false : vx < 0 ? x < m.x : x > m.x;
        if (x === null || past) lo = vy;
        else hi = vy;
      }
      return { vx, vy: (lo + hi) / 2 };
    },
    [ppm, from, m] as const,
  );
}

async function shot(page: Page, info: TestInfo, name: string) {
  await drawn(page);
  await info.attach(name, { body: await page.screenshot(), contentType: "image/png" });
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

test.describe("carrying the trophy", () => {
  test("it bobs until touched; then it follows the hand on a slower spring than a can, and leans at most 3 degrees", async ({ page }) => {
    await wonTrophy(page);
    // floating: it bobs
    const ys: number[] = [];
    for (let i = 0; i < 40; i++) {
      await run(page, 0.07);
      ys.push((await trophy(page)).y);
    }
    expect(Math.max(...ys) - Math.min(...ys), "it bobs while it floats (px)").toBeGreaterThan(2);

    const { width } = page.viewportSize()!;
    const jump = Math.min(150, width * 0.15);
    /** Press at `at`, drag a little, then move the hand `jump` px across at once: how much of the way it has come 3 frames later. */
    async function follow(at: Pt, where: () => Promise<Pt>) {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      const start = { x: at.x, y: at.y - 20 };
      await drag(page, at, start, 4);
      await run(page, 1);
      const before = await where();
      await page.mouse.move(start.x + jump, start.y);
      await run(page, 3 / 60);
      const after = await where();
      await run(page, 1);
      const end = await where();
      await page.mouse.up();
      return { early: (after.x - before.x) / jump, caughtUp: Math.abs(end.x - before.x - jump) };
    }

    const t = await trophy(page);
    const byTrophy = await follow(grabPoint(t), () => trophy(page));
    expect((await trophy(page)).floating, "once touched it no longer floats").toBe(false);
    await until(page, () => trophy(page), (t) => t.state === "placed", "let go, it lands and stands", 5);

    const id = await sandbox<number>(page, `addCan(${await clearFloorX(page)}, ${(await floorY(page)) - 200}, 0)`);
    const c = await until(page, () => can(page, id), (c) => c.state === "placed", "a can stands", 4);
    const byCan = await follow({ x: c.x, y: c.y }, () => can(page, id));
    expect(byTrophy.early, "the trophy has come less of the way than a can would (pull 0.12 against 0.2)").toBeLessThan(byCan.early * 0.85);
    expect(byTrophy.early, "but it does follow").toBeGreaterThan(0);
    expect(byTrophy.caughtUp, "and it catches up with the hand (px)").toBeLessThan(6);

    // swung hard from side to side, it leans no more than 3 degrees
    const t2 = await trophy(page);
    const at = grabPoint(t2);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await drag(page, at, { x: at.x, y: at.y - 40 }, 4);
    let most = 0;
    for (let i = 0; i < 24; i++) {
      const x = at.x + (i % 2 ? jump : -jump) * 0.5;
      await page.mouse.move(x, at.y - 40);
      for (let f = 0; f < 4; f++) {
        await run(page, 1 / 60);
        most = Math.max(most, Math.abs(deg((await trophy(page)).angle)));
      }
    }
    await page.mouse.up();
    expect(most, "it leans a little").toBeGreaterThan(0.2);
    expect(most, "and never more than 3 degrees").toBeLessThanOrEqual(3.05);
  });

  test("carried, it shows a shadow in its own shape, and stands where the shadow showed", async ({ page }, info) => {
    await wonTrophy(page);
    const t = await trophy(page);
    const x = await clearFloorX(page);
    const to = { x, y: (await floorY(page)) - t.height * 0.6 };
    const from = grabPoint(t);
    const hand = { x: to.x + (from.x - t.x), y: to.y + (from.y - t.y) };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await drag(page, from, hand, 30);
    await run(page, 1.8);
    const said = (await sandbox<Pose | null>(page, "trophyRest()"))!;
    const ghost = (await sandbox<Ghost[]>(page, "ghosts()")).find((g) => g.id === "trophy");
    expect(ghost, "a shadow shows while it is carried").toBeTruthy();
    expect(ghost!.alpha, "held still, it is solid").toBeGreaterThan(0.9);
    expect(Math.hypot(ghost!.x - said.x, ghost!.y - said.y), "where it will rest (px)").toBeLessThan(2);
    // its own shape: the picture's size, handles and all, not a can's and not the box it settles as
    expect(Math.abs(ghost!.width! - t.width), "as wide as the trophy as drawn (px)").toBeLessThan(2);
    expect(Math.abs(ghost!.height! - t.height), "as tall (px)").toBeLessThan(2);
    await shot(page, info, "trophy carried, with its own-shape shadow");
    await page.mouse.up();
    const stood = await until(page, () => trophy(page), (t) => t.state === "placed", "it lands and stands", 5);
    expect(Math.hypot(stood.x - said.x, stood.y - said.y), "it stands where the shadow showed (px)").toBeLessThan(6);
    expect(Math.abs(deg(stood.angle - said.angle)), "and turned as it showed (degrees)").toBeLessThan(2);
    expect((await sandbox<Ghost[]>(page, "ghosts()")).some((g) => g.id === "trophy"), "no shadow once let go").toBe(false);
    // and it stays there
    await run(page, 3);
    const later = await trophy(page);
    expect(Math.hypot(later.x - stood.x, later.y - stood.y)).toBeLessThan(0.5);
  });

  test("set down, no ball wedges beside its stem: a ball touching its sides rests on the floor or on another ball", async ({ page }) => {
    await wonTrophy(page);
    const t = await setDown(page);
    const floor = await floorY(page);
    // twenty balls let go just over its sides and its cup, seeded
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 20; i++) {
      const x = t.x - t.width * 0.6 + rand() * t.width * 1.2;
      await sandbox(page, `drop(${x}, ${t.y - t.height - 20 - rand() * 60})`);
      await run(page, 0.15);
    }
    await run(page, 6);
    const hull = await sandbox<Pt[]>(page, "trophyHull()");
    expect(hull.length, "the court has its outline").toBeGreaterThanOrEqual(4);
    const rim = Math.min(...hull.map((p) => p.y));
    // A wedged ball is held up by the trophy itself. One touching its side may rest on the floor or on another ball (balls stack in the
    // gap to the bench), but never on nothing. (Changed on QWW-105: the first version read ordinary stacking as wedging.)
    const all = (await balls(page)).filter((b) => !b.pinned && !b.held);
    for (const b of all) {
      const { d, inside } = fromPolygon(b, hull);
      expect(inside, `ball ${b.id} is not inside the trophy`).toBe(false);
      if (d < b.r + 3 && b.y > rim) {
        const onFloor = Math.abs(b.y - (floor - b.r)) < 3;
        const onBall = all.some((o) => o.id !== b.id && o.y > b.y + 2 && Math.hypot(o.x - b.x, o.y - b.y) < o.r + b.r + 3);
        expect(onFloor || onBall, `ball ${b.id} touches its side, so it rests on the floor or on a ball beneath it`).toBe(true);
      }
    }
  });

  test("a ball dropping into the cup is hidden below the front of the rim, then it is gone", async ({ page }, info) => {
    await wonTrophy(page);
    const t = await trophy(page);
    const id = await sandbox<number>(page, `drop(${t.mouth.x}, ${t.mouth.y - 50})`);
    let hidden = false;
    let shown = false;
    for (let i = 0; i < 120; i++) {
      await run(page, 1 / 60);
      const b = (await balls(page)).find((b) => b.id === id);
      if (!b) break;
      if (b.y < t.mouth.y - b.r * 1.5) expect(b.behindLip, "above the rim, it is drawn whole").toBe(false);
      if (b.behindLip && !shown) {
        shown = true;
        await shot(page, info, "a ball going into the cup, behind the front of the rim");
      }
      hidden ||= b.behindLip;
    }
    expect(hidden, "on its way in it is drawn behind the front of the rim").toBe(true);
    expect((await balls(page)).some((b) => b.id === id), "then it is gone").toBe(false);
  });

  test("a can stands in its cup and the floating trophy stops bobbing under it; carried off, the can falls", async ({ page }) => {
    test.skip(page.viewportSize()!.height < 400, "a window this short has no room for a can above the trophy");
    await wonTrophy(page);
    const t = await trophy(page);
    const id = await sandbox<number>(page, `addCan(${t.mouth.x}, ${t.mouth.y - 120}, 0)`);
    const c = await until(page, () => can(page, id), (c) => c.state === "placed", "the can stands", 5);
    expect(Math.abs(c.x - t.mouth.x), "in the cup, across").toBeLessThan(t.mouth.half);
    expect(c.y + c.height / 2, "its bottom below the rim").toBeGreaterThan((await trophy(page)).mouth.y);
    const ys: number[] = [];
    for (let i = 0; i < 40; i++) {
      await run(page, 0.07);
      ys.push((await trophy(page)).y);
    }
    expect(Math.max(...ys) - Math.min(...ys), "the trophy no longer bobs (px)").toBeLessThan(0.5);
    // carried off from under it, the can falls
    const t2 = await trophy(page);
    const from = grabPoint(t2);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await drag(page, from, { x: from.x + t2.width, y: from.y }, 10);
    const fell = await until(page, () => can(page, id), (c) => c.state !== "placed", "the can falls", 1);
    expect(fell.state).toBe("settling");
    await page.mouse.up();
    await until(page, () => can(page, id), (c) => c.state === "placed", "and stands again", 5);
  });
});

test.describe("scoring into the trophy", () => {
  test("a whole match is won through the trophy after Play again", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "the throws themselves are checked on a desktop");
    const { width } = page.viewportSize()!;
    await wonTrophy(page);
    await playAgain(page).click();
    await run(page, 0.5);
    expect((await game(page)).won).toBe(false);
    const from0 = (await game(page)).log.length;
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const s = (window as any).__sandbox;
        for (const b of s.balls()) if (!b.pinned && !b.held) s.remove(b.id);
      });
      const m = (await trophy(page)).mouth;
      const from = { x: m.x + (m.x < width / 2 ? 1 : -1) * width * 0.34, y: 40 };
      const v = await aim(page, from, m);
      await sandbox(page, `launch(${from.x}, ${from.y}, ${v.vx}, ${v.vy})`);
      await run(page, 2.5);
    }
    const g = await until(page, () => game(page), (g) => g.log.slice(from0).some((e) => e.event === "stats"), "the stats come down", 20);
    expect(g.won, "won by three throws into the trophy").toBe(true);
    expect(when(g.log.slice(from0), "trophy-in"), "and no new trophy").toBeUndefined();
  });
});

test.describe("a later win with the trophy moved", () => {
  test("set down: it stays exactly where it stands, the glint plays on its rim, then the stats; and so after Restart", async ({ page }, info) => {
    const first = await wonTrophy(page);
    const floating = await trophy(page);
    const offset = glintOffset(when(first, "glint")!, floating);
    const before = await setDown(page);
    await playAgain(page).click();
    const log = await win(page);
    const after = await trophy(page);
    expect(when(log, "trophy-in"), "no new trophy").toBeUndefined();
    expect(Math.hypot(after.x - before.x, after.y - before.y), "it has not moved (px)").toBeLessThan(0.5);
    expect(Math.abs(deg(after.angle - before.angle)), "nor turned (degrees)").toBeLessThan(0.1);
    const half = when(log, "confetti-half")!;
    const glint = when(log, "glint")!;
    expect(glint.t - half.t, "1.6 s after half the confetti has passed").toBeGreaterThan(1.5);
    expect(glint.t - half.t).toBeLessThan(1.7);
    const o = glintOffset(glint, after);
    expect(Math.hypot(o.x - offset.x, o.y - offset.y), "on its rim, where it glinted the first time (px)").toBeLessThan(3);
    expect(when(log, "stats")!.t).toBeGreaterThanOrEqual(glint.t);
    await shot(page, info, "a later win, the trophy set down");

    await restart(page).click();
    await run(page, 1);
    const kept = await trophy(page);
    expect(Math.hypot(kept.x - before.x, kept.y - before.y), "Restart leaves it standing where it was (px)").toBeLessThan(0.5);
    await findGame(page);
    const log2 = await win(page);
    expect(when(log2, "trophy-in")).toBeUndefined();
    const again = await trophy(page);
    expect(Math.hypot(again.x - before.x, again.y - before.y), "and so does the win after it (px)").toBeLessThan(0.5);
  });

  test("standing tilted: it keeps its place and its tilt, and the glint plays on its rim turned with it", async ({ page }, info) => {
    const first = await wonTrophy(page);
    const floating = await trophy(page);
    const offset = glintOffset(when(first, "glint")!, floating);
    // a ball on the floor for one side of its base to land on
    const k = perMm(floating);
    const floor = await floorY(page);
    const x = await clearFloorX(page);
    // (in this window's own pixels: the trophy is drawn smaller than real in a small window and the ball is not, so the ball goes under the edge of its base, a radius in)
    const r = (await balls(page))[0].r;
    const id = await sandbox<number>(page, `drop(${x + 136 * k - r}, ${floor - 40})`);
    await until(page, () => balls(page), (bs) => Math.abs(bs.find((b) => b.id === id)!.vy) < 1, "the ball lies on the floor", 4);
    await run(page, 1);
    // carried by the left of its base, so the hand is clear of the ball
    await carryTo(page, { x, y: floor - floating.height * 0.6 }, -40);
    const before = await trophy(page);
    expect(Math.abs(deg(before.angle)), "it stands tilted on the ball (degrees)").toBeGreaterThan(2);
    await playAgain(page).click();
    const log = await win(page);
    const after = await trophy(page);
    expect(when(log, "trophy-in"), "no new trophy").toBeUndefined();
    expect(Math.hypot(after.x - before.x, after.y - before.y), "it has not moved (px)").toBeLessThan(0.5);
    expect(Math.abs(deg(after.angle - before.angle)), "and its tilt is as it was (degrees)").toBeLessThan(0.1);
    const glint = when(log, "glint")!;
    const o = glintOffset(glint, after);
    expect(Math.hypot(o.x - offset.x, o.y - offset.y), "the glint is on its rim, turned with it (px)").toBeLessThan(3);
    await shot(page, info, "a later win, the trophy standing tilted, the glint turned with it");
  });
});

test.describe("the trophy by touch", () => {
  for (const size of [
    { width: 844, height: 390 },
    { width: 750, height: 280 },
  ])
    test(`at ${size.width} x ${size.height}, a finger carries the trophy and sets it down while another holds a ball`, async ({ page }, info) => {
      test.skip(info.project.name !== "iphone-landscape", "a phone held sideways, by touch; the two sizes are set here");
      await page.setViewportSize(size);
      await page.reload();
      await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
      await freeze(page);
      await wonTrophy(page);
      const t = await trophy(page);
      // a dot: the second finger takes it off the "i" (the right one: the stats card covers the left one in a window this small)
      const loose = (await balls(page)).filter((b) => b.pinned).sort((a, b) => b.x - a.x)[0];
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: "touchStart" | "touchMove" | "touchEnd", pts: Pt[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
      const from = grabPoint(t);
      const to = { x: await clearFloorX(page), y: (await floorY(page)) - t.height * 0.6 };
      const hand = { x: to.x + (from.x - t.x), y: to.y + (from.y - t.y) };
      await touch("touchStart", [from]);
      for (let i = 1; i <= 20; i++) {
        await touch("touchMove", [{ x: from.x + ((hand.x - from.x) * i) / 20, y: from.y + ((hand.y - from.y) * i) / 20 }]);
        await run(page, 1 / 60);
      }
      expect((await trophy(page)).state, "the finger carries it").toBe("held");
      await touch("touchStart", [hand, { x: loose.x, y: loose.y }]);
      await run(page, 1 / 60);
      let both = false;
      for (let i = 1; i <= 6; i++) {
        await touch("touchMove", [hand, { x: loose.x + i * 10, y: loose.y - i * 6 }]);
        await run(page, 1 / 60);
        const b = (await balls(page)).find((x) => x.id === loose.id)!;
        both ||= (await trophy(page)).state === "held" && b.held;
      }
      expect(both, "the trophy and a ball are held at once").toBe(true);
      await run(page, 1.5);
      const said = (await sandbox<Pose | null>(page, "trophyRest()"))!;
      await touch("touchEnd", []);
      const stood = await until(page, () => trophy(page), (t) => t.state === "placed", "let go, it stands", 5);
      expect(Math.hypot(stood.x - said.x, stood.y - said.y), "where its shadow showed (px)").toBeLessThan(6);
      expect(stood.y, "inside the window").toBeLessThanOrEqual(size.height);
    });
});
