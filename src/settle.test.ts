import { describe, expect, it } from "vitest";
import { clearSpot, makeSolid, overlapsSolids, predictRest, settleConstants, type SettleWorld } from "./settle";

/** A can, as the court has it: 79 x 249 mm. */
const HW = 0.079 / 2;
const HH = 0.249 / 2;
const K = () => settleConstants(0.249);
const box = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const world = (solids: ReturnType<typeof makeSolid>[] = [], discs: SettleWorld["discs"] = []): SettleWorld => ({ width: 2.4, height: 1.5, solids, discs });
const deg = (a: number) => (Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI;

describe("the can's settle (v7)", () => {
  it("dropped onto the floor, it lands standing on it", () => {
    const rest = predictRest({ x: 1, y: 0.5, a: 0 }, 0, 0, 0, HW, HH, world(), K());
    expect(rest.y).toBeCloseTo(HH, 2);
    expect(Math.abs(deg(rest.a))).toBeLessThan(1);
  });

  it("lands on top of a solid box, not inside it", () => {
    const bench = makeSolid([box(0.6, 0, 1.6, 0.3)]);
    const rest = predictRest({ x: 1, y: 0.8, a: 0 }, 0, 0, 0, HW, HH, world([bench]), K());
    expect(rest.y - HH).toBeGreaterThan(0.297);
    expect(rest.y - HH).toBeLessThan(0.31);
  });

  it("set down a little way from a ball, it tips over and leans on it", () => {
    const r = 0.0335;
    const ball = { x: 1 + HW + r + 0.01, y: r, r };
    const rest = predictRest({ x: 1, y: HH + 0.05, a: 0 }, 0, 0, 0, HW, HH, world([], [ball]), K());
    // leaning to the right, toward the ball: clockwise, a negative angle here
    expect(deg(rest.a)).toBeLessThan(-7);
    expect(deg(rest.a)).toBeGreaterThan(-60);
  });

  it("set down far from anything, it stands up straight", () => {
    const r = 0.0335;
    const ball = { x: 1.5, y: r, r };
    const rest = predictRest({ x: 1, y: HH + 0.05, a: 0.1 }, 0, 0, 0, HW, HH, world([], [ball]), K());
    expect(Math.abs(deg(rest.a))).toBeLessThan(1);
  });

  it("runs the same way every time, so the preview matches the let go", () => {
    const bench = makeSolid([box(0.6, 0, 1.6, 0.3)]);
    const discs = [{ x: 1.1, y: 0.3335, r: 0.0335 }];
    const a = predictRest({ x: 1.02, y: 0.9, a: 0.2 }, 0.8, -0.4, 1.5, HW, HH, world([bench], discs), K());
    const b = predictRest({ x: 1.02, y: 0.9, a: 0.2 }, 0.8, -0.4, 1.5, HW, HH, world([bench], discs), K());
    expect([b.x, b.y, b.a]).toEqual([a.x, a.y, a.a]);
  });

  it("never stops in mid-air, even past its time limit", () => {
    const rest = predictRest({ x: 1, y: 1.4, a: 0 }, 0, 2, 0, HW, HH, world(), K());
    expect(rest.contacts).toBeGreaterThan(0);
  });
});

describe("outlines (v7)", () => {
  it("knows a hole is not solid, whichever way its outlines run", () => {
    const outer = box(0, 0, 1, 1);
    const hole = box(0.3, 0.3, 0.7, 0.7);
    for (const solid of [makeSolid([outer, hole]), makeSolid([[...outer].reverse(), hole]), makeSolid([outer, [...hole].reverse()])]) {
      // a can standing in the hole, clear of the walls, overlaps nothing; one across the wall does
      const w = world([solid]);
      expect(overlapsSolids({ x: 0.5, y: 0.5, a: 0 }, 0.05, 0.1, w)).toBe(false);
      expect(overlapsSolids({ x: 0.15, y: 0.5, a: 0 }, 0.05, 0.1, w)).toBe(true);
    }
  });
});

describe("letting go inside something (v7)", () => {
  it("starts from the nearest clear spot, straight up when that is as near", () => {
    const bench = makeSolid([box(0.6, 0, 1.6, 0.3)]);
    const w = world([bench]);
    const spot = clearSpot({ x: 1, y: 0.3, a: 0 }, HW, HH, w);
    expect(overlapsSolids(spot, HW, HH, w)).toBe(false);
    expect(spot.x).toBeCloseTo(1, 6);
    expect(spot.y - HH).toBeGreaterThan(0.299);
    expect(spot.y - HH).toBeLessThan(0.305);
  });

  it("goes out the side when that is much nearer than the top", () => {
    const wall = makeSolid([box(1, 0, 1.6, 1.2)]);
    const w = world([wall]);
    const spot = clearSpot({ x: 1.01, y: 0.6, a: 0 }, HW, HH, w);
    expect(overlapsSolids(spot, HW, HH, w)).toBe(false);
    expect(spot.x).toBeLessThan(1 - HW + 0.002);
    expect(Math.abs(spot.y - 0.6)).toBeLessThan(0.01);
  });
});
