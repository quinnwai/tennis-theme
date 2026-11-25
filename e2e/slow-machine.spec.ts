// Step 7 of QWW-99 (QWW-106): the whole game on a slow machine. The processor is slowed 4 times (Chromium's CPU throttling) in both
// groups below.
//
// 1. "a whole match on a slow machine" is the frame-rate run. It is a measurement, not a check that gives the same answer on any machine:
//    it plays in real time (the court is not frozen), so a busy machine slows it. It runs only with E2E_PERF=1, which `npm run perf` sets,
//    at 1280 x 800 on the desktop and at 750 x 280 on the phone held sideways. Run it on a quiet machine and paste the numbers it prints
//    (also attached to the report as perf-<project>.json). What it plays: a can poured to find the game, the can carried, a dozen balls
//    thrown, the match won (by the hook: scoring by aim is not what is measured), the confetti, the trophy coming down and the stats, then
//    the trophy carried and set down.
//    What "60 frames a second" is measured as: the time the page's own frame (src/main.ts `frame`: stepping the court and drawing it)
//    takes, each frame, with the processor slowed 4 times. It holds 60 when that work fits in a 60th of a second: at most 1% of frames
//    over 16.7 ms, none over 50 ms. Counting requestAnimationFrame calls does not work here: Playwright's headless browser paces its own
//    frames (an idle page with nothing slowed gets about 16 a second, with 200 ms gaps), so that count is printed for reference only.
// 2. "two fingers on a slow machine" runs in every `npm run e2e`, on the touch projects: one finger carries a can while another throws a
//    ball, at 844 x 390 and at 750 x 280, with the court frozen so the answer does not depend on the machine.
//
// What this asks of the test hook, window.__sandbox:
// - frameWork(): the milliseconds (performance.now(), so slowed with the processor) each call of the page's frame took, from its start to
//   the end of drawing, since the last call of frameWork(), oldest first; reading empties it. Only real-time frames count (not `advance`).

import { freeze, run, until } from "./frozen";
import { expect, type CDPSession, type Page } from "@playwright/test";
import { test } from "./test";

interface Pt {
  x: number;
  y: number;
}
interface Ball extends Pt {
  id: number;
  r: number;
  pinned: boolean;
  held: boolean;
}
interface Can extends Pt {
  id: number;
  state: string;
  held: boolean;
  height: number;
}
interface Game {
  found: boolean;
  won: boolean;
  log: { event: string; t: number }[];
  trophy: (Pt & { state: string; height: number }) | null;
}

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const balls = (page: Page) => sandbox<Ball[]>(page, "balls()");
const cans = (page: Page) => sandbox<Can[]>(page, "cans()");
const can = async (page: Page, id: number) => (await cans(page)).find((c) => c.id === id)!;
const game = (page: Page) => sandbox<Game>(page, "game()");

/** The floor as the page draws it: the window's bottom, lifted on a touch screen. */
async function floorY(page: Page) {
  const lift = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? (window as any).__sandbox.params.floorLiftPx : 0));
  return (await sandbox<{ height: number }>(page, "scene()")).height - lift;
}

async function slowDown(page: Page, rate = 4) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return cdp;
}

async function open(page: Page) {
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
}

/** One pointer, in real time: the mouse on the desktop, a finger (Chromium's touch events) on a touch screen. */
function pointer(page: Page, cdp: CDPSession, touch: boolean) {
  let at: Pt = { x: 0, y: 0 };
  const send = (type: string, pts: Pt[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 1 })) });
  return {
    async down(p: Pt) {
      at = p;
      if (touch) await send("touchStart", [p]);
      else {
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
      }
    },
    /** Move to `to` over `ms` of real time, a step a frame. */
    async move(to: Pt, ms: number) {
      const from = at;
      const steps = Math.max(1, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        at = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
        if (touch) await send("touchMove", [at]);
        else await page.mouse.move(at.x, at.y);
        await page.waitForTimeout(16);
      }
    },
    async up() {
      if (touch) await send("touchEnd", []);
      else await page.mouse.up();
    },
    async tap(p: Pt) {
      if (touch) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y, { delay: 80 });
    },
  };
}

/** Real seconds until `ok`, polling the page; fails after `max` seconds. */
async function waitFor<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, max: number): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    expect(Date.now() - start, `${what}: within ${max} s`).toBeLessThan(max * 1000);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test.describe("a whole match on a slow machine", () => {
  test("holds 60 frames a second with the processor slowed 4 times, through the match and the celebration", async ({ page }, info) => {
    test.skip(!process.env.E2E_PERF, "a measurement: run it with `npm run perf` on a quiet machine");
    test.skip(!["chromium", "iphone-landscape"].includes(info.project.name), "measured at 1280 x 800 and at 750 x 280");
    test.setTimeout(240_000);
    const touch = !!info.project.use.hasTouch;
    if (!touch) await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    const cdp = await slowDown(page);
    const hand = pointer(page, cdp, touch);
    const floor = await floorY(page);

    // count every frame the page draws from here on, and how long the page's own work in each one takes
    await sandbox(page, "frameWork()");
    const work: number[] = [];
    const collect = async () => work.push(...(await sandbox<number[]>(page, "frameWork()")));
    await page.evaluate(() => {
      const w = window as any;
      w.__frames = [] as number[];
      let last = performance.now();
      const tick = (now: number) => {
        w.__frames.push(now - last);
        last = now;
        if (!w.__framesStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const workMarks: Record<string, number> = {};
    const mark = async (name: string) => {
      await collect();
      workMarks[name] = work.length;
    };

    // find the game: a full can on the floor, tapped so it pours
    const id = await sandbox<number>(page, `addCan(120, ${floor - 200}, 3)`);
    let c = await waitFor(() => can(page, id), (c) => c.state === "placed", "the can stands", 10);
    await hand.tap(c);
    await waitFor(() => game(page), (g) => g.found, "the game is found", 15);
    await mark("found");

    // carry the can across the floor and back, and let it go
    c = await waitFor(() => can(page, id), (c) => c.state === "placed", "the poured can stands again", 15);
    await hand.down(c);
    await hand.move({ x: c.x + 200, y: c.y - 120 }, 1200);
    await hand.move({ x: c.x + 60, y: c.y - 60 }, 800);
    await hand.up();
    await mark("carried");

    // throw a dozen balls: each loose ball (or a dot) picked up and flung up and to the right
    for (let i = 0; i < 12; i++) {
      const loose = (await balls(page)).filter((b) => !b.held);
      const b = loose[i % loose.length];
      if (!b) break;
      await hand.down(b);
      await hand.move({ x: b.x + 40, y: b.y - 60 }, 120);
      await hand.up();
      await page.waitForTimeout(250);
    }
    await mark("thrown");

    // win the match, then the confetti, the trophy and the stats
    const from = (await game(page)).log.length;
    for (let i = 0; i < 3; i++) {
      await sandbox(page, "scorePoint()");
      await page.waitForTimeout(400);
    }
    await waitFor(() => game(page), (g) => g.log.slice(from).some((e) => e.event === "stats"), "the stats come down", 40);
    await mark("celebrated");

    // carry the trophy by its base across the floor and set it down
    const t = (await game(page)).trophy!;
    const grab = { x: t.x, y: t.y - t.height * 0.1 };
    await hand.down(grab);
    await hand.move({ x: 150, y: floor - 60 }, 1500);
    await hand.up();
    await page.waitForTimeout(1500);
    await mark("trophy");

    const frames = await page.evaluate(() => {
      (window as any).__framesStop = true;
      return (window as any).__frames as number[];
    });
    const stats = (dts: number[]) => {
      const total = dts.reduce((s, d) => s + d, 0);
      const sorted = [...dts].sort((a, b) => a - b);
      return {
        frames: dts.length,
        seconds: +(total / 1000).toFixed(2),
        fps: +((dts.length * 1000) / total).toFixed(1),
        p50ms: +sorted[Math.floor(sorted.length * 0.5)].toFixed(1),
        p95ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
        over25ms: dts.filter((d) => d > 25).length,
        worstMs: +sorted[sorted.length - 1].toFixed(1),
      };
    };
    const dts = frames.slice(1); // the first is the gap before counting began
    const busy = (ms: number[]) => {
      const sorted = [...ms].sort((a, b) => a - b);
      return {
        frames: ms.length,
        p50ms: +sorted[Math.floor(sorted.length * 0.5)].toFixed(2),
        p95ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
        p99ms: +sorted[Math.floor(sorted.length * 0.99)].toFixed(2),
        over16_7ms: ms.filter((d) => d > 1000 / 60).length,
        worstMs: +sorted[sorted.length - 1].toFixed(2),
      };
    };
    const phases: Record<string, ReturnType<typeof busy>> = {};
    let prev = 0;
    for (const [name, end] of Object.entries(workMarks)) {
      if (end > prev) phases[name] = busy(work.slice(prev, end));
      prev = end;
    }
    const report = {
      project: info.project.name,
      viewport: page.viewportSize(),
      cpuSlowdown: 4,
      frameWork: busy(work),
      phases,
      browserFrames: stats(dts), // for reference only: the headless browser paces these itself
    };
    console.log(`perf ${JSON.stringify(report, null, 2)}`);
    await info.attach(`perf-${info.project.name}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });

    expect(report.frameWork.frames, "the page drew frames all the way through (at least 10 a second)").toBeGreaterThan(report.browserFrames.seconds * 10);
    expect(report.frameWork.over16_7ms / report.frameWork.frames, "at most 1% of frames take the page longer than a 60th of a second").toBeLessThanOrEqual(0.01);
    expect(report.frameWork.worstMs, "and none longer than 50 ms").toBeLessThanOrEqual(50);
  });
});

test.describe("two fingers on a slow machine", () => {
  for (const size of [
    { width: 844, height: 390 },
    { width: 750, height: 280 },
  ]) {
    test(`one finger carries a can while another throws a ball, processor slowed 4 times, at ${size.width} x ${size.height}`, async ({ page }, info) => {
      test.skip(!info.project.use.hasTouch, "a touch screen only");
      await page.setViewportSize(size);
      await open(page);
      await freeze(page);
      const cdp = await slowDown(page);
      const floor = await floorY(page);
      const id = await sandbox<number>(page, `addCan(100, ${floor - 200})`);
      const c0 = await until(page, () => can(page, id), (c) => c.state === "placed", "the new can comes to stand on the floor", 4);
      // a dot: the second finger takes it off the "i" (the right one, furthest from the can)
      const loose = (await balls(page)).filter((b) => b.pinned).sort((a, b) => b.x - a.x)[0];
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
        await touch("touchMove", [hand, { x: loose.x - i * 14, y: loose.y - i * 6 }]);
        await run(page, 1 / 60);
        const c = await can(page, id);
        const b = (await balls(page)).find((x) => x.id === loose.id)!;
        both ||= c.held && b.held;
      }
      expect(both, "the can and the ball are held at once").toBe(true);
      await touch("touchEnd", []);
      await run(page, 0.5);
      const thrown = (await balls(page)).find((x) => x.id === loose.id)!;
      expect(thrown.held, "the ball is thrown").toBe(false);
      expect(Math.abs(thrown.x - loose.x) + Math.abs(thrown.y - loose.y), "and has left the dot's place (px)").toBeGreaterThan(thrown.r * 2);
      await until(page, () => can(page, id), (c) => c.state === "placed", "the can is let go and stands", 4);
    });
  }
});
