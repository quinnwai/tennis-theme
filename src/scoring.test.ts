// QWW-102 (step 3 of QWW-99): the scoring rule on the court, written before the change by chief-keef. Ported from the v7 prototype's
// src/physics.test.ts ("v7 scoring"), less the trophy (step 6), plus the balls that never score.
//
// What these ask of src/physics.ts beyond what it has:
// - `export type Entry`, with at least "point", "too close" and "dropped" (the prototype's names)
// - `Court.onCanEntry?: (can: Can, ball: Ball, entry: Entry) => void`, called once for each ball that goes into a can, judged as it goes in
// - `Court.launch(x, y, vx, vy): Ball`: a ball let go by a hand from that point at that speed (m, m/s, y up), remembered as thrown from
//   there, as the prototype's `launch`
//
// The rule (QWW-99, "A point"): a ball thrown or tapped by a hand that goes into a can, and that set off at least a fifth of the court's
// width from where it went in, measured in a straight line in any direction. A ball let go slower than 0.8 m/s, a poured ball and a new
// ball never score. Nothing here may be weakened to pass; a check that is wrong is argued on QWW-102.

import { afterEach, describe, expect, it } from "vitest";
import { params } from "./params";
import { Court, STEP, type Entry } from "./physics";
import { CAN_HEIGHT } from "./cans";

const RADIUS = params.ballDiameter / 2;
const defaults = { ...params };
afterEach(() => Object.assign(params, defaults));

function run(court: Court, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) court.step();
}

/** Where a throw from `from` (m, y up) comes back down through height `y`, or null: gravity and air drag as the court's. */
function crossing(from: { x: number; y: number }, vx: number, vy: number, y: number): number | null {
  let [px, py, ux, uy] = [from.x, from.y, vx, vy];
  for (let i = 0; i < 2400; i++) {
    const speed = Math.hypot(ux, uy);
    if (speed > 0.5) {
      const keep = Math.max(0, 1 - params.drag * speed * STEP);
      ux *= keep;
      uy *= keep;
    }
    uy -= params.gravity * STEP;
    const [nx, ny] = [px + ux * STEP, py + uy * STEP];
    if (uy < 0 && py >= y && ny <= y) return px + ((nx - px) * (y - py)) / (ny - py);
    [px, py] = [nx, ny];
  }
  return null;
}

/** Collect how each ball into a can was judged. */
function watch(court: Court): Entry[] {
  const entries: Entry[] = [];
  court.onCanEntry = (_can, _ball, entry) => entries.push(entry);
  return entries;
}

/** Throw a ball from `from` so it comes down into `mouth` (m, y up) about `t` s later; how it was judged, if it went in. */
function throwInto(court: Court, from: { x: number; y: number }, mouth: { x: number; y: number }, t = 0.6): Entry[] {
  const entries = watch(court);
  let v = { x: 0, y: -1.5 }; // straight down
  if (Math.abs(mouth.x - from.x) > 1e-6) {
    const vx = (mouth.x - from.x) / t;
    let [lo, hi] = [-30, 30];
    for (let i = 0; i < 60; i++) {
      const vy = (lo + hi) / 2;
      const x = crossing(from, vx, vy, mouth.y + RADIUS);
      const past = x !== null && (vx < 0 ? x < mouth.x : x > mouth.x);
      if (x === null || !past) lo = vy;
      else hi = vy;
    }
    v = { x: vx, y: (lo + hi) / 2 };
  }
  court.launch(from.x, from.y, v.x, v.y);
  run(court, 2.5);
  return entries;
}

/** A court 4 m wide (a fifth of it: 0.8 m), with an empty can standing on the floor, or on a shelf. */
function canCourt(shelf = false, balls = 0) {
  const top = shelf ? 1.3 : 0;
  const letters = shelf ? [[{ x: 1.5, y: 1.2 }, { x: 2.5, y: 1.2 }, { x: 2.5, y: top }, { x: 1.5, y: top }]] : [];
  const court = new Court(4, 3, letters);
  court.addCan(2, top + CAN_HEIGHT / 2, 0, balls, 0, false, { state: "placed" });
  run(court, 0.5);
  return { court, mouth: { x: 2, y: top + CAN_HEIGHT } };
}

describe("scoring (v7)", () => {
  // Quinn-Wai: it's the whole way a throw travels that counts, a fifth of the width in a straight line, any direction
  it.each([
    ["straight down from high above", 0, 1.1, "point"],
    ["straight down from close above", 0, 0.6, "too close"],
    ["on a slant, past a fifth", 0.6, 0.6, "point"],
    ["on a slant, short of a fifth", 0.5, 0.5, "too close"],
    ["from level, past a fifth", 0.9, 0, "point"],
    ["from level, short of a fifth", 0.75, 0.1, "too close"],
  ] as const)("scores a throw %s (%s m across, %s m up) as a %s", (_what, across, up, want) => {
    const { court, mouth } = canCourt();
    expect(throwInto(court, { x: mouth.x + across, y: mouth.y + up }, mouth)).toEqual([want]);
  });

  it("scores a throw from below, up and over onto a can on a shelf", () => {
    const { court, mouth } = canCourt(true);
    expect(throwInto(court, { x: mouth.x + 0.9, y: 0.4 }, mouth, 0.7)).toEqual(["point"]);
  });

  it("never scores a ball that was only dropped, from however high", () => {
    const { court, mouth } = canCourt();
    const entries = watch(court);
    court.addBall(mouth.x, mouth.y + 1.5, false);
    run(court, 2);
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toBe("point");
  });

  it("never scores a ball let go slower than 0.8 m/s, even from far enough away", () => {
    const { court, mouth } = canCourt();
    const entries = watch(court);
    court.launch(mouth.x, mouth.y + 1.2, 0, -0.7);
    run(court, 2);
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toBe("point");
  });

  it("takes no ball into a full can", () => {
    const { court, mouth } = canCourt(false, 3);
    expect(throwInto(court, { x: mouth.x + 0.9, y: mouth.y + 0.4 }, mouth)).toEqual([]);
  });
});
