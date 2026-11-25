// QWW-104 (step 5 of QWW-99): the win celebration, written before the change by chief-keef. Confetti over the whole window and the win
// sound; once half the confetti has passed, the trophy comes down from the top and floats over the middle of the name, about 9% of the
// window's height above it (up to a fifth smaller on short windows); once it settles, a glint, then the stats. A later win brings no new
// trophy: the one already won stays put and glints when a new one would have settled (1.6 s after half the confetti has passed). The
// prototype's checks/check-again.mjs is the model; the set-down and tilted later wins are step 6.
//
// What these checks ask of the test hook, window.__sandbox, beyond what step 4 added:
// - game().log: what the celebration did, in order, with the court's time in seconds:
//   [{ event: "won" | "confetti-half" | "trophy-in" | "trophy-settled" | "glint" | "stats", t, x?, y? }] (a glint gives where it is, page px)
// - game().trophy: null until a match is won, then { x, y, width, height, angle, floating }: the middle of its foot (page px), its size
//   as drawn (px), its turn (radians clockwise) and whether it is floating
// - params.cheerVolume: how loud the win sound plays (0 to 1); game().heard gains "cheer" each time it starts
// In a frozen court (QWW-95) the celebration runs on the court's clock, as the stats delay already does, so `advance` moves it.
// Nothing here may be weakened to pass; a check that is wrong is argued on QWW-104.

import { freeze, run, until } from "./frozen";
import { expect, type Page } from "@playwright/test";
import { test } from "./test";

interface LogEntry {
  event: string;
  t: number;
  x?: number;
  y?: number;
}
interface Trophy {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  floating: boolean;
}
interface Game {
  found: boolean;
  won: boolean;
  heard: string[];
  log: LogEntry[];
  trophy: Trophy | null;
}

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const game = (page: Page) => sandbox<Game>(page, "game()");
const playAgain = (page: Page) => page.getByRole("button", { name: "Play again" });
const restart = (page: Page) => page.getByRole("button", { name: "Clear the balls" });

async function floorY(page: Page) {
  const lift = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? (window as any).__sandbox.params.floorLiftPx : 0));
  return page.viewportSize()!.height - lift;
}

/** Find the game: a full can put down and tapped, so it pours. */
async function findGame(page: Page) {
  const id = await sandbox<number>(page, `addCan(120, ${(await floorY(page)) - 200}, 3)`);
  const c = await until(page, async () => (await sandbox<any[]>(page, "cans()")).find((c) => c.id === id), (c) => c.state === "placed", "the can stands", 4);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await run(page, 0.1);
  await page.mouse.up();
  await until(page, () => game(page), (g) => g.found, "the game is found", 6);
}

/** Win the match by the hook, and run the court until the stats are down. Gives the log entries of this win. */
async function win(page: Page) {
  const from = (await game(page)).log.length;
  for (let i = 0; i < 3; i++) await sandbox(page, "scorePoint()");
  const g = await until(page, () => game(page), (g) => g.log.slice(from).some((e) => e.event === "stats"), "the stats come down", 20, 0.25);
  return g.log.slice(from);
}

/** The name as laid out: its middle across and its top (page px). */
async function name(page: Page) {
  const layout = await sandbox<{ letters: { loops: { x: number; y: number }[][] }[] }>(page, "layout()");
  const pts = layout.letters.flatMap((l) => l.loops.flat());
  const xs = pts.map((p) => p.x);
  return { middle: (Math.min(...xs) + Math.max(...xs)) / 2, top: Math.min(...pts.map((p) => p.y)) };
}

const when = (log: LogEntry[], event: string) => log.find((e) => e.event === event);

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

test.describe("the first win", () => {
  test("in order: won, half the confetti passed, the trophy comes in from the top and settles, a glint, then the stats", async ({ page }) => {
    await findGame(page);
    expect((await game(page)).trophy, "no trophy before a win").toBeNull();
    const log = await win(page);
    const order = ["won", "confetti-half", "trophy-in", "trophy-settled", "glint", "stats"];
    const times = order.map((e) => when(log, e)?.t);
    for (const [i, t] of times.entries()) expect(t, `${order[i]} happened`).toBeDefined();
    for (let i = 1; i < times.length; i++) expect(times[i]!, `${order[i]} after ${order[i - 1]}`).toBeGreaterThanOrEqual(times[i - 1]!);
  });

  test("the trophy floats over the middle of the name, about 9% of the window's height above it, and fits the window", async ({ page }) => {
    await findGame(page);
    await win(page);
    const { width, height } = page.viewportSize()!;
    const t = (await game(page)).trophy!;
    const n = await name(page);
    expect(t.floating).toBe(true);
    expect(Math.abs(t.x - n.middle), "over the middle of the name (px)").toBeLessThan(width * 0.03);
    // its foot about 9% of the window's height above the name's top (it bobs, so a little either way)
    expect(n.top - t.y, "its foot above the name").toBeGreaterThan(height * 0.04);
    expect(n.top - t.y).toBeLessThan(height * 0.14);
    expect(t.y - t.height, "its top inside the window").toBeGreaterThanOrEqual(0);
  });

  test("the win plays the cheer once, at 95% volume, and only Quinn-Wai's cheer", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));
    await findGame(page);
    await win(page);
    const g = await game(page);
    expect(g.heard.filter((h) => h === "cheer"), "the cheer, once").toHaveLength(1);
    expect(await sandbox<number>(page, "params.cheerVolume")).toBeCloseTo(0.95, 5);
    expect(requested.some((u) => /successful-event/.test(u)), "successful-event is the file").toBe(true);
    expect(requested.some((u) => /success-fx/.test(u)), "the prototype's success-fx is not shipped").toBe(false);
  });

  test("with the sound off, the win plays no cheer but everything else happens", async ({ page }) => {
    await page.getByRole("button", { name: /^Sound/ }).click();
    await findGame(page);
    const log = await win(page);
    expect((await game(page)).heard).not.toContain("cheer");
    expect(when(log, "trophy-settled")).toBeDefined();
    expect(when(log, "glint")).toBeDefined();
  });

  test("the trophy is credited, and the cheer needs no credit line", async ({ page }) => {
    await page.getByRole("button", { name: "Credits", exact: true }).click();
    const credits = page.getByRole("dialog", { name: "Credits" });
    await expect(credits).toContainText(/Norman Brookes Challenge Cup/);
  });
});

test.describe("a later win", () => {
  test("after Play again, no new trophy: the floating one stays put, and the glint plays on it 1.6 s after half the confetti has passed, then the stats", async ({ page }) => {
    await findGame(page);
    await win(page);
    const before = (await game(page)).trophy!;
    await playAgain(page).click();
    const log = await win(page);
    expect(when(log, "trophy-in"), "no trophy comes down this time").toBeUndefined();
    const after = (await game(page)).trophy!;
    const { height } = page.viewportSize()!;
    expect(Math.abs(after.x - before.x), "it stayed across (px)").toBeLessThan(2);
    expect(Math.abs(after.y - before.y), "and up and down, give or take its bob (px)").toBeLessThan(height * 0.03);
    const half = when(log, "confetti-half")!;
    const glint = when(log, "glint")!;
    expect(glint.t - half.t, "1.6 s after half the confetti has passed").toBeGreaterThan(1.5);
    expect(glint.t - half.t).toBeLessThan(1.7);
    expect(Math.abs(glint.x! - after.x), "on the trophy").toBeLessThan(after.width);
    expect(glint.y!, "at its rim, above its foot").toBeLessThan(after.y);
    expect(glint.y!).toBeGreaterThan(after.y - after.height - 10);
    expect(when(log, "stats")!.t).toBeGreaterThanOrEqual(glint.t);
  });

  test("after Restart and finding the game again, the trophy is still there, and a win keeps it there", async ({ page }) => {
    await findGame(page);
    await win(page);
    const before = (await game(page)).trophy!;
    await restart(page).click();
    await run(page, 1);
    expect((await game(page)).found).toBe(false);
    expect((await game(page)).trophy, "kept through Restart").not.toBeNull();
    await findGame(page);
    const log = await win(page);
    expect(when(log, "trophy-in")).toBeUndefined();
    expect(Math.abs((await game(page)).trophy!.x - before.x)).toBeLessThan(2);
  });

  test("leaving the page does not keep the trophy", async ({ page }) => {
    await findGame(page);
    await win(page);
    await page.reload();
    await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
    expect((await game(page)).trophy).toBeNull();
  });
});
