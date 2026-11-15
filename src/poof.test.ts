import { afterEach, describe, expect, it } from "vitest";
import { params } from "./params";
import { CHIPS_PER_BURST, MAX_BURSTS, Poof } from "./poof";
import { area, chipsOf, covers, type Chip } from "./test-chips";

const defaults = { ...params };
afterEach(() => Object.assign(params, defaults));

/** A ball 20 px in radius, so 40 px across, like the ball on a laptop screen. */
const R = 20;
const WIDTH = 2 * R;
/** Where the test bursts happen. */
const AT = { x: 300, y: 300 };

/** What is on screen at `now`. Ask for times in order: bursts that have finished are forgotten. */
const chipsAt = (poof: Poof, now: number, r = R): Chip[] => chipsOf(poof, now, r);

const bornAt = (...times: number[]) => {
  const poof = new Poof();
  for (const t of times) poof.add(AT.x, AT.y, t);
  return poof;
};

const distance = (c: Chip) => Math.hypot(c.x - AT.x, c.y - AT.y);

/**
 * The outline of the solid part of a burst: for each of `rays` directions, how far out from the
 * point you can walk before you leave the chips. Chips thrown off on their own do not count.
 */
function outline(chips: Chip[], rays = 90): number[] {
  const reaches: number[] = [];
  for (let k = 0; k < rays; k++) {
    const a = (k / rays) * Math.PI * 2;
    let t = 0;
    while (t < 6 * WIDTH && chips.some((c) => covers(c, AT.x + Math.cos(a) * t, AT.y + Math.sin(a) * t))) t += 0.5;
    reaches.push(t);
  }
  return reaches;
}

/** How many points a star has: places where the outline reaches clearly further out than on either side. */
function points(reaches: number[]): number {
  const n = reaches.length;
  const median = [...reaches].sort((a, b) => a - b)[Math.floor(n / 2)];
  let count = 0;
  for (let k = 0; k < n; k++) {
    const here = reaches[k];
    // The top of a run of equal reaches counts once.
    if (here > 1.25 * median && here > reaches[(k + n - 1) % n] && here >= reaches[(k + 1) % n]) count++;
  }
  return count;
}

describe("the poof where a ball is hit", () => {
  it("is a jagged starburst of chips: a solid middle with several points sticking out", () => {
    const poof = bornAt(0);
    const chips = chipsAt(poof, 30);
    expect(chips).toHaveLength(CHIPS_PER_BURST);
    const reaches = outline(chips);
    // It is solid in the middle: every direction gets out of the point.
    expect(Math.min(...reaches)).toBeGreaterThan(0.2 * WIDTH);
    // It has points: several places where the outline reaches out well past the middle, so the
    // longest reach is far more than the shortest.
    expect(points(reaches)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...reaches)).toBeGreaterThan(1.8 * Math.min(...reaches));
    // And about a ball wide, or a little more, from the middle to the tip of the longest. (A streak
    // that lines up with a point can add to it, hence the room.)
    expect(Math.max(...reaches)).toBeGreaterThan(0.7 * WIDTH);
    expect(Math.max(...reaches)).toBeLessThan(2.5 * WIDTH);
  });

  it("throws off long thin streaks and little flecks past the points", () => {
    const chips = chipsAt(bornAt(0), 30);
    const reaches = outline(chips);
    const body = [...reaches].sort((a, b) => a - b)[Math.floor(reaches.length / 2)];
    // Several long thin chips, each starting beyond the body of the star.
    const thin = chips.filter((c) => c.halfLength > 4 * c.halfThickness);
    expect(thin.length).toBeGreaterThanOrEqual(4);
    expect(thin.every((c) => distance(c) - c.halfLength > body)).toBe(true);
    // And several little square flecks, also beyond it.
    const flecks = chips.filter((c) => c.halfLength === c.halfThickness && c.halfLength < 0.12 * WIDTH);
    expect(flecks.length).toBeGreaterThanOrEqual(4);
    expect(flecks.every((c) => distance(c) > body)).toBe(true);
  });

  it("surrounds the point it happened at, in every direction", () => {
    const chips = chipsAt(bornAt(0), 30);
    const sectors = new Set(chips.map((c) => Math.floor(((Math.atan2(c.y - AT.y, c.x - AT.x) + Math.PI) / (Math.PI * 2)) * 8) % 8));
    expect(sectors.size).toBe(8);
    expect(Math.max(...chips.map(distance))).toBeLessThan(3 * WIDTH);
  });

  it("opens out at the start, then flies apart: the chips go further from the point and get smaller", () => {
    const poof = bornAt(0);
    const life = params.poofLifetime * 1000;
    const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
    const samples = [0.25, 0.5, 0.75, 0.95].map((u) => {
      const chips = chipsAt(poof, u * life);
      return { out: mean(chips.map(distance)), size: mean(chips.map(area)) };
    });
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].out).toBeGreaterThan(samples[i - 1].out);
      expect(samples[i].size).toBeLessThan(samples[i - 1].size);
    }
    // By the end they are specks.
    expect(samples[3].size).toBeLessThan(0.1 * samples[0].size);
  });

  it("starts smaller than it ends up, so it pops open", () => {
    const early = chipsAt(bornAt(0), 0);
    const open = chipsAt(bornAt(0), 0.18 * params.poofLifetime * 1000);
    expect(Math.max(...outline(early))).toBeLessThan(0.75 * Math.max(...outline(open)));
  });

  it("is gone once its lifetime is up", () => {
    const poof = bornAt(100);
    const life = params.poofLifetime * 1000;
    expect(poof.live(100)).toBe(1);
    expect(poof.shapes(100 + 0.5 * life, R)).toBeGreaterThan(0);
    expect(poof.live(100 + 0.5 * life)).toBe(1);
    expect(poof.shapes(100 + life, R)).toBe(0);
    expect(poof.live(100 + life)).toBe(0);
    expect(poof.shapes(100 + 60000, R)).toBe(0);
  });

  it("lasts as long as the lifetime number says", () => {
    params.poofLifetime = 1;
    const longer = bornAt(0);
    expect(longer.shapes(600, R)).toBeGreaterThan(0); // already gone at the default 0.2 s
    expect(longer.shapes(1000, R)).toBe(0);
    params.poofLifetime = 0.1;
    const shorter = bornAt(0);
    expect(shorter.shapes(50, R)).toBeGreaterThan(0);
    expect(shorter.shapes(100, R)).toBe(0);
  });

  it("counts bursts, not chips", () => {
    const poof = bornAt(0, 40, 80);
    expect(poof.live(100)).toBe(3);
    expect(poof.shapes(100, R)).toBe(3 * CHIPS_PER_BURST);
    // The first has finished, the others are still going.
    expect(poof.live(params.poofLifetime * 1000 + 10)).toBe(2);
  });

  it("looks different each time, and the same burst always looks the same", () => {
    const poof = bornAt(0, 0);
    const [first, second] = [0, 1].map((k) => chipsAt(poof, 30).slice(k * CHIPS_PER_BURST, (k + 1) * CHIPS_PER_BURST));
    expect(first).toHaveLength(CHIPS_PER_BURST);
    expect(second).toHaveLength(CHIPS_PER_BURST);
    // Same place and time, but not the same shape.
    expect(outline(first).join()).not.toBe(outline(second).join());
    // A second burst number 0 made later draws the very same chips.
    const again = chipsAt(bornAt(0), 30);
    expect(again.map((c) => [c.x, c.y, c.halfLength, c.halfThickness])).toEqual(first.map((c) => [c.x, c.y, c.halfLength, c.halfThickness]));
  });

  it("keeps each burst at its own place", () => {
    const poof = new Poof();
    poof.add(100, 100, 0);
    poof.add(900, 500, 0);
    const chips = chipsAt(poof, 40);
    const near = (c: Chip, x: number, y: number) => Math.hypot(c.x - x, c.y - y) < 3 * WIDTH;
    expect(chips.every((c) => near(c, 100, 100) || near(c, 900, 500))).toBe(true);
    expect(chips.some((c) => near(c, 100, 100))).toBe(true);
    expect(chips.some((c) => near(c, 900, 500))).toBe(true);
  });

  it("scales with the ball, and with the size number", () => {
    const reach = (r: number) => Math.max(...outline(chipsAt(bornAt(0), 30, r)));
    const normal = reach(R);
    expect(reach(2 * R)).toBeGreaterThan(1.7 * normal);
    params.poofSize = 2;
    expect(reach(R)).toBeGreaterThan(1.7 * normal);
  });

  it("gives up the oldest bursts when more happen at once than it can hold", () => {
    const poof = new Poof();
    for (let i = 0; i < 40; i++) poof.add(i * 10, 0, i); // 40 hits within 40 ms
    expect(poof.live(40)).toBe(MAX_BURSTS);
    const chips = chipsAt(poof, 40);
    expect(chips).toHaveLength(MAX_BURSTS * CHIPS_PER_BURST);
    // The newest are kept and the first are what was given up: burst 39 is at x = 390, and the
    // oldest kept is number 32, at x = 320, whose chips reach no further left than about 240.
    expect(chips.some((c) => c.x > 380)).toBe(true);
    expect(chips.every((c) => c.x > 200)).toBe(true);
  });

  it("does not break when a burst is born a moment after the frame it is drawn in", () => {
    // The page times a hit when it happens, and the next frame can carry an earlier time.
    const poof = bornAt(1000);
    expect(poof.live(995)).toBe(1);
    const chips = chipsAt(poof, 995);
    expect(chips).toHaveLength(CHIPS_PER_BURST);
    expect(chips.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && c.halfLength >= 0 && c.halfThickness >= 0)).toBe(true);
  });
});
