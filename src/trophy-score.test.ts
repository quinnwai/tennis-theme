// QWW-105 (step 6 of QWW-99): balls into the trophy score by the same rule as a can, floating or set down. Written before the change by
// chief-keef. Ported from the v7 prototype's src/physics.test.ts ("scores a ball into the trophy like one into a can"), plus the same
// throws into a trophy that has been touched and set down.
//
// What these ask of src/physics.ts beyond what it has:
// - `Court.setTrophy(outline, mouth, at, box)`: the trophy as a solid in the court, as the prototype's: `outline` (m, y up, around its
//   anchor), `mouth` (the middle of the rim from the anchor, and how far it opens either side), `at` (where its anchor floats), and `box`
//   (the box it settles as once touched: its middle from the anchor and its half sizes)
// - `Court.onTrophyEntry?: (ball: Ball, entry: Entry) => void`, called once for each ball that goes into the trophy, judged as it goes in
// - `Court.freeTrophy(settle?: boolean)`: the trophy has been touched; with `settle`, it falls from where it is and stands where it lands
// - `Court.trophyMouth(): { x, y, half } | null`: where the rim's middle is now (m, y up) and how far it opens either side
//
// The rule is QWW-99's "A point", the same as for a can (src/scoring.test.ts). Nothing here may be weakened to pass; a check that is wrong
// is argued on QWW-105.

import { afterEach, describe, expect, it } from "vitest";
import { params } from "./params";
import { Court, STEP, type Entry } from "./physics";

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

/** Collect how each ball into the trophy was judged. */
function watch(court: Court): Entry[] {
  const entries: Entry[] = [];
  court.onTrophyEntry = (_ball, entry) => entries.push(entry);
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

/** A court 4 m wide (a fifth of it: 0.8 m) with a plain cup 0.2 m wide and 0.3 m tall, floating with its foot at (2, `y`). */
function trophyCourt(y = 0.5) {
  const court = new Court(4, 3, []);
  const cup = [
    { x: -0.1, y: 0 },
    { x: 0.1, y: 0 },
    { x: 0.1, y: 0.3 },
    { x: -0.1, y: 0.3 },
  ];
  court.setTrophy(cup, { x: 0, y: 0.3, half: 0.1 }, { x: 2, y }, { cx: 0, cy: 0.15, hw: 0.1, hh: 0.15 });
  return court;
}

describe("scoring into the trophy (v7)", () => {
  it("scores a ball into the floating trophy like one into a can", () => {
    // the prototype's case as it stands
    const court = trophyCourt();
    const mouth = { x: 2, y: 0.8 };
    expect(throwInto(court, { x: 1.1, y: 1.4 }, mouth)).toEqual(["point"]);
    expect(throwInto(court, { x: 2.4, y: 1.0 }, mouth)).toEqual(["too close"]);
    const entries = watch(court);
    court.addBall(2, 1.2, false);
    run(court, 1.5);
    expect(entries).toEqual(["dropped"]);
  });

  it("tells where the floating trophy's mouth is", () => {
    const m = trophyCourt().trophyMouth()!;
    expect(m.x).toBeCloseTo(2, 3);
    expect(m.y).toBeCloseTo(0.8, 3);
    expect(m.half).toBeCloseTo(0.1, 3);
  });

  it("scores the same way into the trophy once it has been touched and set down on the floor", () => {
    const court = trophyCourt(1);
    court.freeTrophy(true);
    run(court, 3);
    const mouth = court.trophyMouth()!;
    expect(mouth.y, "it came down to the floor and stands there").toBeCloseTo(0.3, 2);
    expect(Math.abs(mouth.x - 2), "where it was let go").toBeLessThan(0.01);
    // across from a fifth of the width and more, straight down from high above: points; from close: too close
    expect(throwInto(court, { x: mouth.x - 0.9, y: mouth.y + 0.4 }, mouth)).toEqual(["point"]);
    expect(throwInto(court, { x: mouth.x, y: mouth.y + 1.1 }, mouth)).toEqual(["point"]);
    expect(throwInto(court, { x: mouth.x + 0.5, y: mouth.y + 0.3 }, mouth)).toEqual(["too close"]);
    const entries = watch(court);
    court.addBall(mouth.x, mouth.y + 1.2, false);
    run(court, 1.5);
    expect(entries, "a dropped ball goes in but never scores").toEqual(["dropped"]);
  });

  it("never scores a ball let go slower than 0.8 m/s into the trophy, even from far enough away", () => {
    const court = trophyCourt();
    const entries = watch(court);
    court.launch(2, 0.8 + 1.2, 0, -0.7);
    run(court, 2);
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toBe("point");
  });

  it("stands still once set down: it neither bobs nor drifts", () => {
    const court = trophyCourt(1);
    court.freeTrophy(true);
    run(court, 3);
    const a = court.trophyMouth()!;
    run(court, 3);
    const b = court.trophyMouth()!;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(1e-4);
  });
});
