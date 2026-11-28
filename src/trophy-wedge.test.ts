// QWW-120: balls wedged again in the slit beside the set-down trophy's right edge on a phone (750 x 280), a regression of QWW-107. It
// showed in the browser test only some runs, and only with the court's fixtures as QWW-113 left them: which wedge a ball falls into seems
// to depend on how many static bodies there are. So this asks it of the court with 0, 1 and 4 pegs, and of several drops each.
//
// The court is built as src/main.ts builds it (name, floor lift on a touch screen, pegs), with the trophy fitted, let go near x = 150 and
// standing on the floor. Balls are dropped around it and over its cup as the browser test drops them. After that every ball is asleep:
// none is left shivering against the trophy's side, awake and running the engine's continuous collision (a court that crawled).

import { afterEach, describe, expect, it } from "vitest";
import { floorLiftFor } from "./controls";
import type { Vec } from "./input";
import { params } from "./params";
import { Court, STEP } from "./physics";
import { TROPHY, TROPHY_BOX, TROPHY_HULL, trophyFit } from "./trophy";
import { layoutName } from "./wordmark";
import { WORDMARKS } from "./wordmark.data";

const [W, H] = [750, 280];
const defaults = { ...params };
afterEach(() => Object.assign(params, defaults));

function run(court: Court, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) court.step();
}

/** The court a phone held sideways has, with the trophy let go over x = `over` px, and `pegs` solid discs at the corners. */
function court(pegCount: number, over: number): { court: Court; px: number; trophyLeft: number; trophyRight: number } {
  const layout = layoutName(W, H, WORDMARKS[Object.keys(WORDMARKS)[0]], params.ballScale);
  const px = layout.ballPx / params.ballDiameter;
  const toMeters = (p: Vec) => ({ x: p.x / px, y: (H - p.y) / px });
  const outlines = layout.letters.flatMap((l) => l.loops.map((loop) => loop.map(toMeters)));
  const nameTop = Math.min(...layout.letters.flatMap((l) => l.loops.flat().map((p) => p.y)));
  const spots = [
    { x: W - 30, y: H - 30, radius: 22 },
    { x: W - 30, y: 30, radius: 22 },
    { x: W - 80, y: 30, radius: 22 },
    { x: W - 130, y: 30, radius: 22 },
  ].slice(0, pegCount);
  const pegs = spots.map((s) => ({ ...toMeters(s), radius: s.radius / px }));
  const c = new Court(W / px, H / px, outlines, pegs, floorLiftFor(true) / px);
  const fit = trophyFit(px / 1000, nameTop, W, H);
  const s = fit.scale / 1000;
  c.setTrophy(
    TROPHY_HULL.map(([x, y]) => ({ x: x * s, y: y * s })),
    { x: TROPHY.rimX * s, y: TROPHY.rim * s, half: TROPHY.open * s },
    toMeters({ x: over, y: H - floorLiftFor(true) - TROPHY_BOX.hh * 2 * s * px }),
    { cx: TROPHY_BOX.cx * s, cy: TROPHY_BOX.cy * s, hw: TROPHY_BOX.hw * s, hh: TROPHY_BOX.hh * s },
  );
  c.freeTrophy(true);
  run(c, 3);
  const hull = c.trophyHull();
  return { court: c, px, trophyLeft: Math.min(...hull.map((p) => p.x)), trophyRight: Math.max(...hull.map((p) => p.x)) };
}

describe("balls dropped around a trophy set down near x = 150 on a 750 x 280 window", () => {
  for (const pegCount of [0, 1, 4]) {
    it(`all fall asleep, with ${pegCount} peg${pegCount === 1 ? "" : "s"} on the court (QWW-120)`, () => {
      const stuck: string[] = [];
      for (const seed0 of [7, 23]) {
        const { court: c, px, trophyLeft, trophyRight } = court(pegCount, 150);
        let seed = seed0;
        const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const width = trophyRight - trophyLeft;
        const top = c.trophyMouth()!.y;
        for (let i = 0; i < 20; i++) {
          c.addBall(trophyLeft - width * 0.1 + rand() * width * 1.2, top + (20 + rand() * 60) / px, false);
          run(c, 0.15);
        }
        run(c, 12);
        if (c.awakeBalls() > 0) stuck.push(`seed ${seed0}: ${c.awakeBalls()} awake`);
      }
      expect(stuck).toEqual([]);
    }, 120_000);
  }
});
