import { afterEach, describe, expect, it } from "vitest";
import { params } from "./params";
import { Court } from "./physics";
import { area, chipsOf, covers, type Chip } from "./test-chips";
import { CAPACITY, Trail, leavesTrail } from "./trail";
import { FIELDS } from "./tune";

const defaults = { ...params };
afterEach(() => Object.assign(params, defaults));

/** A ball 20 px in radius, so 40 px across, like the ball on a laptop screen. */
const R = 20;
const WIDTH = 2 * R;
const FRAME_MS = 1000 / 60;
/** The row of pixels the test balls fly along. */
const LINE = 200;

/** What is on screen at `now`, oldest chip first. Ask for times in order: chips that have gone are forgotten. */
const chipsAt = (trail: Trail, now: number, r = R): Chip[] => chipsOf(trail, now, r);

/** How far a chip reaches from the line the ball flew along, straight across. */
const reach = (c: Chip) => Math.abs(c.y - LINE) + c.halfLength * Math.abs(c.cy) + c.halfThickness * Math.abs(c.cx);

/** Fly a ball along the line, reporting it every frame, as the page does. Returns where it ended up, and the time in ms. */
function fly(trail: Trail, id: number, pxPerSecond: number, seconds: number, radius = R): { x: number; t: number } {
  let t = 0;
  let x = 100;
  trail.follow(id, x, LINE, radius, t);
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    t += FRAME_MS;
    x += pxPerSecond / 60;
    trail.follow(id, x, LINE, radius, t);
  }
  return { x, t };
}

/**
 * The share of points on a grid that some chip covers: from `back` to `back2` ball widths behind the
 * ball, and across the middle `across` ball widths of the band.
 */
function coverage(all: Chip[], ballX: number, back: number, back2: number, across = 0.8): number {
  let covered = 0;
  let samples = 0;
  for (let b = back * WIDTH; b <= back2 * WIDTH; b += 1) {
    for (let a = -0.5 * across * WIDTH; a <= 0.5 * across * WIDTH; a += 1) {
      samples++;
      if (all.some((c) => covers(c, ballX - b, LINE + a))) covered++;
    }
  }
  return covered / samples;
}

describe("the trail of a ball in flight", () => {
  it("is a solid band about as wide as the ball, right behind it", () => {
    const trail = new Trail();
    const end = fly(trail, 1, 1800, 0.3);
    const all = chipsAt(trail, end.t);
    // From half a ball behind the ball to one and a half behind it: no gaps in the middle of the band,
    // and only small notches along its chunky edges.
    expect(coverage(all, end.x, 0.5, 1.5, 0.5)).toBeGreaterThan(0.99);
    expect(coverage(all, end.x, 0.5, 1.5, 0.9 * params.trailWidth)).toBeGreaterThan(0.88);
    // And it is no wider than the band asked for, near the ball where nothing has drifted yet.
    const newest = all.filter((c) => c.x > end.x - 2 * WIDTH);
    expect(Math.max(...newest.map(reach))).toBeLessThanOrEqual(0.5 * params.trailWidth * WIDTH + 2);
    // As wide as the band asked for: chips reach most of the way to its edges.
    expect(Math.max(...newest.map(reach))).toBeGreaterThan(0.4 * params.trailWidth * WIDTH);
  });

  it("breaks into smaller pieces, scattered off the ball's line, further back", () => {
    const trail = new Trail();
    const end = fly(trail, 1, 1800, 0.3);
    const all = chipsAt(trail, end.t);
    const near = coverage(all, end.x, 0.5, 1.5);
    const middle = coverage(all, end.x, 4, 6);
    const far = coverage(all, end.x, 8, 10);
    // Each stretch further back has more gaps than the one before.
    expect(near).toBeGreaterThan(middle + 0.15);
    expect(middle).toBeGreaterThan(far + 0.15);
    expect(middle).toBeLessThan(0.8);
    expect(far).toBeLessThan(0.4);
    expect(far).toBeGreaterThan(0); // a few pieces are still there

    // Chips are listed oldest first, so thirds of the list are the far, middle and near stretches.
    const third = Math.floor(all.length / 3);
    const mean = (list: Chip[]) => list.reduce((sum, c) => sum + area(c), 0) / list.length;
    expect(all.length).toBeGreaterThan(60);
    expect(mean(all.slice(0, third))).toBeLessThan(0.5 * mean(all.slice(-third)));

    // The pieces further back have wandered off the line the ball took, more than those just behind it.
    const spread = (from: number, to: number) => {
      const here = all.filter((c) => c.x < end.x - from * WIDTH && c.x >= end.x - to * WIDTH);
      return Math.sqrt(here.reduce((sum, c) => sum + (c.y - LINE) ** 2, 0) / here.length);
    };
    expect(spread(6, 12)).toBeGreaterThan(1.3 * spread(0, 2));
  });

  it("makes a chip smaller with every moment of its life", () => {
    const trail = new Trail();
    // Move a pixel at a time until the first chip drops: exactly one chip.
    let x = 100;
    trail.follow(1, x, LINE, R, 0);
    while (trail.shapes(0, R) === 0) trail.follow(1, (x += 1), LINE, R, 0);
    expect(trail.shapes(0, R)).toBe(1);
    let previous = Infinity;
    let sampled = 0;
    let age = 0;
    for (; age < 2 * params.trailLifetime * 1000; age += 5) {
      const now = chipsAt(trail, age);
      if (now.length === 0) break;
      expect(area(now[0])).toBeLessThan(previous);
      previous = area(now[0]);
      sampled++;
    }
    // It lived a good while, got smaller the whole time, and was gone by the full lifetime.
    expect(sampled).toBeGreaterThan(20);
    expect(age).toBeLessThanOrEqual(params.trailLifetime * 1000);
  });

  it("has no chips left once the lifetime is up", () => {
    const trail = new Trail();
    const end = fly(trail, 1, 1800, 0.3);
    const life = params.trailLifetime * 1000;
    expect(trail.shapes(end.t, R)).toBeGreaterThan(0);
    expect(trail.shapes(end.t + 0.5 * life, R)).toBeGreaterThan(0);
    expect(trail.shapes(end.t + life, R)).toBe(0);
    expect(trail.shapes(end.t + 60000, R)).toBe(0);
  });

  it("lasts as long as the lifetime number says", () => {
    params.trailLifetime = 1;
    const longer = new Trail();
    const a = fly(longer, 1, 1800, 0.2);
    expect(longer.shapes(a.t + 600, R)).toBeGreaterThan(0); // already gone at the default 0.4 s
    expect(longer.shapes(a.t + 1000, R)).toBe(0);

    params.trailLifetime = 0.1;
    const shorter = new Trail();
    const b = fly(shorter, 1, 1800, 0.2);
    expect(shorter.shapes(b.t + 50, R)).toBeGreaterThan(0);
    expect(shorter.shapes(b.t + 100, R)).toBe(0);
  });

  it("leaves nothing behind a ball that does not move", () => {
    const trail = new Trail();
    for (let i = 0; i < 120; i++) trail.follow(1, 300, 300, R, i * FRAME_MS);
    expect(trail.shapes(120 * FRAME_MS, R)).toBe(0);
  });

  it("ages the chips along one long step by when the ball was there, so a slow frame leaves no stairs", () => {
    const trail = new Trail();
    trail.follow(1, 100, LINE, R, 0);
    trail.follow(1, 400, LINE, R, 100); // one slow frame: 300 px in 100 ms
    const all = chipsAt(trail, 150);
    const third = Math.floor(all.length / 3);
    const mean = (list: Chip[]) => list.reduce((sum, c) => sum + area(c), 0) / list.length;
    // The chips from the start of the step are 150 ms old, those from its end 50 ms.
    expect(all.length).toBeGreaterThan(60);
    expect(mean(all.slice(0, third))).toBeLessThan(0.7 * mean(all.slice(-third)));
  });

  it("does not loop forever for a ball with no size, as in a window with no size", () => {
    const trail = new Trail();
    trail.follow(1, 0, 0, 0, 0);
    trail.follow(1, 100, 0, 0, FRAME_MS);
    expect(trail.shapes(FRAME_MS, 0)).toBe(0);
  });

  it("starts a new path for a ball that turns up much too far away, rather than painting a streak", () => {
    const trail = new Trail();
    trail.follow(1, 100, 100, R, 0);
    trail.follow(1, 5100, 100, R, FRAME_MS); // 125 ball widths in one frame
    expect(trail.shapes(FRAME_MS, R)).toBe(0);
    trail.follow(1, 5100 + WIDTH, 100, R, 2 * FRAME_MS);
    const here = chipsAt(trail, 2 * FRAME_MS);
    expect(here.length).toBeGreaterThan(0);
    expect(here.every((c) => c.x > 5000)).toBe(true);
  });

  it("does not hang, or draw anything, when handed a position that is endless or not a number, and then carries on", () => {
    const trail = new Trail();
    trail.follow(1, 0, 0, R, 0);
    trail.follow(1, Infinity, 0, R, FRAME_MS);
    trail.follow(1, NaN, NaN, R, 2 * FRAME_MS);
    trail.follow(1, 100, 100, R, 3 * FRAME_MS);
    expect(trail.shapes(3 * FRAME_MS, R)).toBe(0);
    trail.follow(1, 100 + WIDTH, 100, R, 4 * FRAME_MS);
    expect(trail.shapes(4 * FRAME_MS, R)).toBeGreaterThan(0);
  });

  it("starts a fresh path for a ball that was not reported for a while, rather than joining the two", () => {
    const trail = new Trail();
    trail.follow(1, 100, 100, R, 0);
    trail.follow(1, 900, 700, R, 1000); // a second later, far away: not one flight
    expect(trail.shapes(1000, R)).toBe(0);
    trail.follow(1, 900 + WIDTH, 700, R, 1000 + FRAME_MS);
    const here = chipsAt(trail, 1000 + FRAME_MS);
    expect(here.length).toBeGreaterThan(0);
    expect(here.every((c) => c.x > 850 && c.y > 650)).toBe(true);
  });

  it("starts fresh once flights are ended, as when the court is rebuilt and its ball numbers start again", () => {
    const trail = new Trail();
    trail.follow(1, 100, 100, R, 0);
    trail.follow(1, 100 + WIDTH, 100, R, FRAME_MS);
    const before = trail.shapes(FRAME_MS, R);
    expect(before).toBeGreaterThan(0);
    trail.endFlights();
    trail.follow(1, 1000, 600, R, 2 * FRAME_MS); // the same number, a different ball, far away
    expect(trail.shapes(2 * FRAME_MS, R)).toBe(before);
  });

  it("keeps each ball's path to itself", () => {
    const trail = new Trail();
    let t = 0;
    for (let i = 0; i < 20; i++) {
      t += FRAME_MS;
      trail.follow(1, 100 + i * 20, 100, R, t);
      trail.follow(2, 100 + i * 20, 500, R, t);
    }
    const all = chipsAt(trail, t);
    expect(all.length).toBeGreaterThan(20);
    expect(all.some((c) => c.y < 300)).toBe(true);
    expect(all.some((c) => c.y > 300)).toBe(true);
    // Nothing joins the two rows.
    expect(all.every((c) => Math.abs(c.y - 100) < 2 * WIDTH || Math.abs(c.y - 500) < 2 * WIDTH)).toBe(true);
  });

  it("makes the oldest chips make way when more are dropped than it can hold", () => {
    const trail = new Trail();
    // Ten frames, 10 ms apart, each as far as a ball can go in one: about 4,170 chips for room for 4,000.
    let x = 100;
    trail.follow(1, x, LINE, R, 0);
    for (let i = 1; i <= 10; i++) trail.follow(1, (x += 1500), LINE, R, i * 10);
    const all = chipsAt(trail, 100);
    expect(all).toHaveLength(CAPACITY);
    const xs = all.map((c) => c.x);
    expect(Math.max(...xs)).toBeGreaterThan(x - 20); // the newest are kept...
    expect(Math.min(...xs)).toBeGreaterThan(500); // ...and the start of the path is what was given up
  });

  it("stays within its capacity however many balls fly", () => {
    const trail = new Trail();
    let t = 0;
    let most = 0;
    // 60 balls, each sweeping back and forth along its own row at 1500 px/s.
    const sweep = (frame: number, id: number) => {
      const d = (frame * 25 + id * 40) % 2600;
      return 50 + (d < 1300 ? d : 2600 - d);
    };
    for (let frame = 0; frame < 600; frame++) {
      t += FRAME_MS;
      for (let id = 1; id <= 60; id++) trail.follow(id, sweep(frame, id), 20 + id * 12, R, t);
      most = Math.max(most, trail.shapes(t, R));
    }
    expect(most).toBeGreaterThan(0.5 * CAPACITY);
    expect(most).toBeLessThanOrEqual(CAPACITY);
  });

  it("scales with the ball, so the band is as wide as a ball of any size", () => {
    const big = 60;
    const trail = new Trail();
    const end = fly(trail, 1, 2400, 0.1, big);
    const newest = chipsAt(trail, end.t, big).filter((c) => c.x > end.x - 2 * big * 2);
    const widest = Math.max(...newest.map(reach));
    expect(widest).toBeLessThanOrEqual(0.5 * params.trailWidth * 2 * big + 2);
    expect(widest).toBeGreaterThan(0.4 * params.trailWidth * 2 * big);
  });
});

describe("which balls leave a trail", () => {
  it("is a loose ball in flight", () => {
    expect(leavesTrail({ pinned: false, held: false, vx: 3, vy: -1 })).toBe(true);
  });

  it("is not a ball at rest, or one only rolling slowly", () => {
    expect(leavesTrail({ pinned: false, held: false, vx: 0, vy: 0 })).toBe(false);
    expect(leavesTrail({ pinned: false, held: false, vx: 0.4, vy: 0 })).toBe(false);
  });

  it("is not a dot waiting in its stem, however it moves", () => {
    expect(leavesTrail({ pinned: true, held: false, vx: 4, vy: 0 })).toBe(false);
    expect(leavesTrail({ pinned: true, held: true, vx: 4, vy: 0 })).toBe(false);
  });

  it("is a ball being carried, from a much gentler pace than a loose ball needs", () => {
    // 0.5 m/s is a slow roll for a loose ball, which leaves nothing, but a drag with the pointer.
    expect(leavesTrail({ pinned: false, held: false, vx: 0.5, vy: 0 })).toBe(false);
    expect(leavesTrail({ pinned: false, held: true, vx: 0.5, vy: 0 })).toBe(true);
    expect(leavesTrail({ pinned: false, held: true, vx: 3, vy: -2 })).toBe(true);
  });

  it("is not a ball in the hand that is held still, or only trembling", () => {
    expect(leavesTrail({ pinned: false, held: true, vx: 0, vy: 0 })).toBe(false);
    expect(leavesTrail({ pinned: false, held: true, vx: 0.03, vy: 0.02 })).toBe(false);
  });

  it("leaves no trail once a real ball has come to rest: nothing is left on screen a lifetime after its last flight", () => {
    // Drive the real physics the way the page does: every frame, report each ball that leaves a trail.
    const court = new Court(4, 4);
    court.addBall(2, 1.5, false);
    const trail = new Trail();
    const pxPerMeter = 600;
    const ball = court.balls[0];
    const log: { t: number; chips: number }[] = [];
    let t = 0;
    let lastFlight = -1;
    for (let frame = 0; frame < 60 * 14; frame++) {
      for (let k = 0; k < 4; k++) court.step(); // four steps of 1/240 s are one frame of 1/60 s
      t += FRAME_MS;
      if (leavesTrail(ball)) {
        lastFlight = t;
        trail.follow(ball.id, ball.x * pxPerMeter, (4 - ball.y) * pxPerMeter, R, t);
      }
      log.push({ t, chips: trail.shapes(t, R) });
    }
    // It really was in flight, with a trail, for a while...
    expect(lastFlight).toBeGreaterThan(500);
    expect(Math.max(...log.map((entry) => entry.chips))).toBeGreaterThan(10);
    // ...and then came to rest, and for a good while after the last chip's life there was nothing at all.
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThan(0.001);
    expect(leavesTrail(ball)).toBe(false);
    const quiet = log.filter((entry) => entry.t > lastFlight + params.trailLifetime * 1000);
    expect(quiet.length).toBeGreaterThan(120);
    expect(quiet.every((entry) => entry.chips === 0)).toBe(true);
  });
});

describe("the trail of a carried ball", () => {
  it("follows a ball dragged around by the pointer, and is gone a lifetime after the drag stops", () => {
    // Drive the real physics the way the page does: every frame, report each ball that leaves a trail.
    const court = new Court(8, 4);
    const ball = court.addBall(1, 2, true);
    court.grab(ball.id);
    const trail = new Trail();
    const pxPerMeter = 600;
    const log: { t: number; chips: number; moving: boolean }[] = [];
    let t = 0;
    let pointer = 1;
    let lastDrag = 0;
    for (let frame = 0; frame < 60 * 4; frame++) {
      const dragging = frame < 60; // one second of dragging at 1 m/s, then the pointer stays still
      for (let k = 0; k < 4; k++) {
        if (dragging) pointer += 1 / 240;
        court.carryTo(pointer, 2);
        court.step();
      }
      t += FRAME_MS;
      if (dragging) lastDrag = t;
      expect(ball.held).toBe(true);
      if (leavesTrail(ball)) trail.follow(ball.id, ball.x * pxPerMeter, (4 - ball.y) * pxPerMeter, R, t);
      log.push({ t, chips: trail.shapes(t, R), moving: Math.hypot(ball.vx, ball.vy) > 0.2 });
    }
    // While it was being dragged, it left chips behind it.
    expect(Math.max(...log.filter((e) => e.t <= lastDrag).map((e) => e.chips))).toBeGreaterThan(30);
    // Once the pointer stopped, the ball caught up, stopped, and what it had left was gone a lifetime later.
    expect(log[log.length - 1].moving).toBe(false);
    const quiet = log.filter((e) => e.t > lastDrag + 200 + params.trailLifetime * 1000);
    expect(quiet.length).toBeGreaterThan(60);
    expect(quiet.every((e) => e.chips === 0)).toBe(true);
  });
});

describe("the trail's numbers", () => {
  it("are all there", () => {
    expect(Object.keys(params)).toEqual(
      expect.arrayContaining(["trailWidth", "trailPiece", "trailShrink", "trailScatter", "trailLifetime", "trailOpacity", "poofSize", "poofLifetime"]),
    );
  });

  it("each have a slider, with the default inside its range", () => {
    const keys = Object.keys(defaults).filter((key) => key.startsWith("trail") || key.startsWith("poof")) as (keyof typeof defaults)[];
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const key of keys) {
      const field = FIELDS.find(([name]) => name === key);
      expect(field, `a slider for ${key}`).toBeDefined();
      const [, label, min, max, step] = field!;
      expect(label.length, key).toBeGreaterThan(0);
      expect(min, key).toBeLessThanOrEqual(defaults[key]);
      expect(max, key).toBeGreaterThanOrEqual(defaults[key]);
      expect(step, key).toBeGreaterThan(0);
    }
  });

  it("change the trail when moved", () => {
    const flown = () => {
      const trail = new Trail();
      const end = fly(trail, 1, 1800, 0.3);
      return chipsAt(trail, end.t);
    };
    const mostReach = (list: Chip[]) => Math.max(...list.map(reach));
    const total = (list: Chip[]) => list.reduce((sum, c) => sum + area(c), 0);
    const normal = flown();

    params.trailWidth = 0.4;
    expect(mostReach(flown())).toBeLessThan(mostReach(normal));
    Object.assign(params, defaults);

    params.trailPiece = 0.9;
    expect(Math.max(...flown().map(area))).toBeGreaterThan(Math.max(...normal.map(area)));
    Object.assign(params, defaults);

    params.trailShrink = 4;
    expect(total(flown())).toBeLessThan(total(normal));
    Object.assign(params, defaults);

    params.trailScatter = 0;
    expect(mostReach(flown())).toBeLessThan(mostReach(normal));
  });
});
