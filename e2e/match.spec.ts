// QWW-103 (step 4 of QWW-99): the How to play card, winning the match, Play again and Restart. Written before the change by chief-keef.
// The spec is QWW-99's description ("How to play", "The win", "Play again"); the trophy and confetti are step 5, so here the stats come
// after the win without them. Step 5 may put the celebration in between: these checks wait for the stats up to 20 s of the court's time.
//
// What these checks ask of the test hook, window.__sandbox, beyond what step 3 added:
// - scorePoint(): win a point as a counted throw would, once the game is found (the prototype's hook); the throws themselves are
//   checked once here, on a desktop, and in e2e/score.spec.ts
// - game().won: whether the match is won
// And of the page: the match stats are one element marked `data-match-stats`, holding the Play again button.
// Nothing here may be weakened to pass; a check that is wrong is argued on QWW-103.

import { freeze, run, until } from "./frozen";
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./test";

interface Can {
  id: number;
  x: number;
  y: number;
  angle: number;
  ballsLeft: number;
  height: number;
  state: string;
}
interface Game {
  found: boolean;
  won: boolean;
  you: string;
  them: string;
}
interface Pt {
  x: number;
  y: number;
}

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const cans = (page: Page) => sandbox<Can[]>(page, "cans()");
const can = async (page: Page, id: number) => (await cans(page)).find((c) => c.id === id)!;
const game = (page: Page) => sandbox<Game>(page, "game()");
const board = (page: Page) => page.getByText(/nadal/i).first();
const howTo = (page: Page) => page.getByRole("button", { name: /how to play/i });
const stats = (page: Page) => page.locator("[data-match-stats]");
const playAgain = (page: Page) => page.getByRole("button", { name: "Play again" });

async function floorY(page: Page) {
  const lift = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? (window as any).__sandbox.params.floorLiftPx : 0));
  return page.viewportSize()!.height - lift;
}

async function tap(page: Page, at: Pt) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await run(page, 0.1);
  await page.mouse.up();
}

/** Find the game: a can put down full and tapped, so it pours. Gives the can. */
async function findGame(page: Page, x = 120) {
  const id = await sandbox<number>(page, `addCan(${x}, ${(await floorY(page)) - 200}, 3)`);
  const c = await until(page, () => can(page, id), (c) => c.state === "placed", "the can stands", 4);
  await tap(page, c);
  await until(page, () => can(page, id), (c) => c.ballsLeft === 0 && c.state === "placed", "it pours and goes back", 6);
  expect((await game(page)).found).toBe(true);
  return id;
}

/** Wait for something to show, running the court's clock as well as the page's, up to 20 s of the court's time. */
async function untilShown(page: Page, what: Locator, label: string) {
  for (let t = 0; t < 20; t += 0.25) {
    if (await what.isVisible()) return;
    await run(page, 0.25);
    await page.waitForTimeout(50);
  }
  await expect(what, label).toBeVisible();
}

async function winByHook(page: Page) {
  for (let i = 0; i < 3; i++) await sandbox(page, "scorePoint()");
  expect((await game(page)).won).toBe(true);
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

test.describe("How to play", () => {
  test("there is no How to play until the game is found; then its tab slides down the umpire's card with the four steps, and no distance in numbers", async ({ page }) => {
    await expect(howTo(page)).toBeHidden();
    await findGame(page);
    await expect(howTo(page)).toBeVisible();
    await howTo(page).click();
    await run(page, 1);
    // each step exactly as written: in particular "Sink it from a distance" says no distance
    for (const step of ["Tap a can to pour", "Drag a ball to throw", "Sink it from a distance", "Win 3 points, win the match"])
      await expect(page.getByText(step, { exact: true })).toBeVisible();
  });
});

test.describe("winning the match", () => {
  test("three throws from a third of the width away win it: GAME, SET, MATCH, then the stats with Play again", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "the throws themselves are checked on a desktop; the phones win by the hook below");
    const { width } = page.viewportSize()!;
    const id = await findGame(page);
    const ppm = await sandbox<number>(page, "pxPerMeter()");
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const s = (window as any).__sandbox;
        for (const b of s.balls()) if (!b.pinned && !b.held) s.remove(b.id);
      });
      if ((await can(page, id)).ballsLeft >= 3) {
        await tap(page, await can(page, id));
        await run(page, 3);
      }
      const c = await can(page, id);
      const m = { x: c.x + Math.sin(c.angle) * (c.height / 2), y: c.y - Math.cos(c.angle) * (c.height / 2) };
      const from = { x: m.x + width / 3, y: 40 };
      const v = await page.evaluate(
        ([ppm, from, m]) => {
          // the same ballistic aim as e2e/score.spec.ts, done in the page to keep this short
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
            const past = x === null ? false : x < m.x;
            if (x === null || past) lo = vy;
            else hi = vy;
          }
          return { vx, vy: (lo + hi) / 2 };
        },
        [ppm, from, m] as const,
      );
      await sandbox(page, `launch(${from.x}, ${from.y}, ${v.vx}, ${v.vy})`);
      await run(page, 2.5);
    }
    expect((await game(page)).won, "won by three throws").toBe(true);
    await expect(page.getByText(/game,?\s*set,?\s*match/i).first()).toBeVisible();
    await untilShown(page, stats(page), "the stats come down");
    await expect(playAgain(page)).toBeVisible();
  });

  test("the stats are a card on a desktop and one line under the board on a phone held sideways", async ({ page }, info) => {
    test.skip(!["chromium", "iphone-landscape"].includes(info.project.name), "1440 x 800 and 750 x 280");
    await findGame(page);
    await winByHook(page);
    await expect(page.getByText(/game,?\s*set,?\s*match/i).first()).toBeVisible();
    await untilShown(page, stats(page), "the stats come down");
    const box = (await stats(page).boundingBox())!;
    const b = (await board(page).boundingBox())!;
    if (info.project.name === "chromium") {
      expect(box.height, "a card: several lines tall").toBeGreaterThan(60);
    } else {
      expect(box.height, "one line").toBeLessThan(44);
      expect(box.y, "under the board").toBeGreaterThanOrEqual(b.y + b.height - 2);
    }
    await expect(stats(page).getByRole("button", { name: "Play again" })).toBeVisible();
  });
});

test.describe("after the match", () => {
  test("Play again starts a new match at 15-30 and leaves the scene exactly where it was", async ({ page }) => {
    await findGame(page);
    await winByHook(page);
    await untilShown(page, stats(page), "the stats come down");
    const before = await page.evaluate(() => {
      const s = (window as any).__sandbox;
      return { cans: s.cans().map((c: any) => [c.id, c.x, c.y, c.angle]), balls: s.balls().map((b: any) => [b.id, b.x, b.y]) };
    });
    await playAgain(page).click();
    const g = await game(page);
    expect(g.won).toBe(false);
    expect(g.found).toBe(true);
    expect([g.you, g.them]).toEqual(["15", "30"]);
    await expect(stats(page)).toBeHidden();
    await expect(board(page)).toBeVisible();
    const after = await page.evaluate(() => {
      const s = (window as any).__sandbox;
      return { cans: s.cans().map((c: any) => [c.id, c.x, c.y, c.angle]), balls: s.balls().map((b: any) => [b.id, b.x, b.y]) };
    });
    expect(after, "nothing in the scene moved").toEqual(before);
    // and the new match can be won again
    await winByHook(page);
  });

  test("Restart puts everything back in the bag and hides the board", async ({ page }) => {
    await findGame(page);
    await winByHook(page);
    await untilShown(page, stats(page), "the stats come down");
    await page.getByRole("button", { name: "Clear the balls" }).click();
    await run(page, 1);
    const g = await game(page);
    expect(g.found).toBe(false);
    expect(g.won).toBe(false);
    await expect(board(page)).toBeHidden();
    await expect(stats(page)).toBeHidden();
    await expect(howTo(page)).toBeHidden();
    expect(await cans(page), "every can is back in the bag").toHaveLength(0);
    expect((await sandbox<{ open: boolean }>(page, "bag()")).open, "and the bag is zipped").toBe(false);
  });
});
