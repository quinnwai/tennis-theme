// The bench, the bag, the notebook and the cans of balls as the court treats them: what a ball lands on, how a can is carried, let go and
// tapped to pour, and how many balls there can be. The page's own checks of the same things are in e2e/bench-bag.spec.ts.

import { afterEach, describe, expect, it } from "vitest";
import { CAN_BALLS, CAN_COUNT, CAN_HEIGHT, CAN_WIDTH } from "./cans";
import { params } from "./params";
import { Court, MAX_BALLS, STEP } from "./physics";
import { BAG_ANCHOR, bagOutline, bagTopAt, type P } from "./v6/art";
import { sceneLayout, sceneSolids } from "./v6/scene";
import { layoutName } from "./wordmark";
import { WORDMARKS } from "./wordmark.data";

const RADIUS = params.ballDiameter / 2;
const defaults = { ...params };
const deg = (degrees: number) => (degrees * Math.PI) / 180;

afterEach(() => Object.assign(params, defaults));

/** The window of a desktop browser, in meters: always 2.4 m wide, 1.33 m tall at 16 by 9. */
const WIDTH = 2.4;
const HEIGHT = 1.33;

/** Step the court for `seconds`, calling `watch` after every step. */
function run(court: Court, seconds: number, watch?: () => void): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    court.step();
    watch?.();
  }
}

/** How far a can has turned from upright, in degrees, whichever way. */
const tiltOf = (angle: number) => Math.abs((Math.atan2(Math.sin(angle), Math.cos(angle)) * 180) / Math.PI);

/** How long after a tap a can has poured its first ball (it rises for 0.3 s, then the first comes at 0.02 s), and all three (a ball every 0.22 s, then it settles back). */
const POUR_FIRST_BALL_BY = 0.4;
const POUR_ALL_BY = 1.6;

/** A can standing fixed at a point, as one does that has come to rest (or been put back): nothing falls, nothing moves it. */
const stood = { state: "placed" as const };

const atRest = (court: Court) => court.balls.every((b) => Math.hypot(b.vx, b.vy) < 0.001);

/** A court with the bench and the bag in it, as the page builds one for a window `w` by `h` px (letters left out). */
function courtWithScene(w = 1280, h = 800, lift = 0) {
  const name = layoutName(w, h, WORDMARKS.ubuntu, params.ballScale);
  const L = sceneLayout(w, h, name, lift);
  const px = name.ballPx / params.ballDiameter;
  const toM = ([x, y]: P): { x: number; y: number } => ({ x: x / px, y: (h - y) / px });
  const solids = sceneSolids(L);
  const court = new Court(w / px, h / px, [], [], lift / px, [solids.bench.map(toM)]);
  court.setBag([solids.bag.map(toM)]);
  return { L, court, px, toM, solids };
}

describe("the bench and the bag", () => {
  it("holds up a ball dropped over the bench seat, which comes to rest on its middle line", () => {
    const { L, court, toM } = courtWithScene();
    const at = toM([L.benchX + 120 * L.k * 2, L.benchSurfaceY - 400]);
    const ball = court.addBall(at.x, at.y, false);
    run(court, 8);
    expect(atRest(court)).toBe(true);
    expect(ball.y - RADIUS).toBeCloseTo(toM([0, L.benchSurfaceY]).y, 2);
  });

  it("holds up a ball dropped over the bag: it bounces off the bag's outline and never goes down through it", () => {
    const { L, court, px, toM } = courtWithScene();
    const x = L.bagAt[0] + 230 * L.k; // near the bag's highest part
    const topAt = (pageX: number) => L.bagAt[1] + bagTopAt(BAG_ANCHOR[0] + (pageX - L.bagAt[0]) / L.k)! * L.k;
    const at = toM([x, topAt(x) - 300]);
    const ball = court.addBall(at.x, at.y, false);
    let sunk = -Infinity; // the most the ball's bottom was ever below the bag's top, px, while it was over the bag
    run(court, 1.5, () => {
      const pageX = ball.x * px;
      if (bagTopAt(BAG_ANCHOR[0] + (pageX - L.bagAt[0]) / L.k) === null) return;
      const bottom = L.height - (ball.y - RADIUS) * px;
      sunk = Math.max(sunk, bottom - topAt(pageX));
    });
    expect(sunk).toBeGreaterThan(-Infinity); // it was over the bag
    expect(sunk).toBeLessThan(3); // and its bottom was never more than a few px below the bag's top
  });

  it("stops a ball rolling along the bench at the bag's end instead of letting it through", () => {
    const { L, court, toM } = courtWithScene();
    // Along the seat from the left, hard enough to reach the bag's left end, which is a solid wall to it.
    const from = toM([L.benchX + 200 * L.k, L.benchSurfaceY - RADIUS * 1000]);
    const ball = court.addBall(from.x, from.y, false, 1.5, 0);
    let furthest = ball.x;
    run(court, 3, () => (furthest = Math.max(furthest, ball.x)));
    const left = toM([L.bagAt[0] - (BAG_ANCHOR[0] - Math.min(...bagOutline().map((p) => p[0]))) * L.k, 0]).x;
    expect(furthest).toBeLessThan(left + 0.001);
  });

  it("holds up a ball over a solid that comes into the open bag, and lets it down once the solid is gone", () => {
    const { L, court, px, toM } = courtWithScene();
    const x = L.bagAt[0] + 230 * L.k;
    const bagTop = L.bagAt[1] + bagTopAt(BAG_ANCHOR[0] + (x - L.bagAt[0]) / L.k)! * L.k;
    const y = bagTop - 120 * L.k; // a can's lid, standing 12 cm up out of the bag
    const lid = [[x - 60 * L.k, y], [x + 60 * L.k, y], [x + 60 * L.k, y + 60 * L.k], [x - 60 * L.k, y + 60 * L.k]] as P[];
    court.setSolids([lid.map(toM)]);
    const at = toM([x, y - 150 * L.k]);
    const ball = court.addBall(at.x, at.y, false);
    run(court, 1.5);
    expect(L.height - (ball.y - RADIUS) * px).toBeLessThan(y + 3); // it came down on the lid and did not go through it
    court.setSolids([]);
    run(court, 1);
    expect(L.height - (ball.y - RADIUS) * px).toBeGreaterThan(y + 40 * L.k); // the lid is gone: it has come down well below it
  });
});

describe("a can", () => {
  it("stands on the floor, upright and full, with nothing coming out of it", () => {
    const court = new Court(WIDTH, HEIGHT);
    const can = court.addCan(1, CAN_HEIGHT / 2);
    run(court, 3);
    expect(can.ballsLeft).toBe(CAN_BALLS);
    expect(court.balls).toHaveLength(0);
    expect(tiltOf(can.angle)).toBeLessThan(1);
    expect(can.y).toBeCloseTo(CAN_HEIGHT / 2, 2);
    expect(court.canState(can.id)).toBe("placed");
  });

  it("lands upright when it drops from a height, and is still full", () => {
    const court = new Court(WIDTH, HEIGHT);
    const can = court.addCan(1, 0.9);
    expect(court.canState(can.id)).toBe("settling");
    run(court, 3);
    expect(tiltOf(can.angle)).toBeLessThan(2);
    expect(can.ballsLeft).toBe(CAN_BALLS);
    expect(court.balls).toHaveLength(0);
    expect(court.canState(can.id)).toBe("placed");
  });

  it("keeps its balls however it stands or falls: only a tap pours a can", () => {
    const court = new Court(WIDTH, 40); // a window so tall that the can is still falling after 2 s
    const falling = court.addCan(1, 30);
    const tipped = court.addCan(1.6, 30, deg(130));
    run(court, 2);
    expect(falling.y).toBeLessThan(30);
    expect(falling.ballsLeft).toBe(CAN_BALLS);
    expect(tipped.ballsLeft).toBe(CAN_BALLS);
    expect(court.balls).toHaveLength(0);
  });

  it("stays full when it lies mouth down or on its side on the floor", () => {
    const court = new Court(WIDTH, HEIGHT);
    const down = court.addCan(0.6, CAN_HEIGHT / 2, Math.PI);
    const side = court.addCan(1.4, 0.0391, deg(90));
    run(court, 3);
    expect(down.ballsLeft).toBe(CAN_BALLS);
    expect(side.ballsLeft).toBe(CAN_BALLS);
    expect(court.balls).toHaveLength(0);
  });

  it("is a solid thing that balls bounce off", () => {
    const court = new Court(WIDTH, HEIGHT);
    court.addCan(1.5, CAN_HEIGHT / 2);
    const ball = court.addBall(0.5, RADIUS, false);
    params.hitSpeed = 3;
    court.hit(ball.id, 1, 0);
    let furthest = 0;
    run(court, 2, () => (furthest = Math.max(furthest, ball.x)));
    expect(furthest).toBeLessThan(1.5 - 0.039);
  });

  it("makes no sound when it lands: a can meeting the floor is not an impact", () => {
    const court = new Court(WIDTH, HEIGHT);
    court.addCan(1, 0.8);
    let impacts = 0;
    run(court, 1.5, () => (impacts += court.impacts.length));
    expect(impacts).toBe(0);
  });

  it("still lets a ball that meets it count as an impact", () => {
    const court = new Court(WIDTH, HEIGHT);
    court.addCan(1.5, CAN_HEIGHT / 2, 0, CAN_BALLS, 0, false, stood);
    const ball = court.addBall(0.5, RADIUS, false);
    params.hitSpeed = 3;
    court.hit(ball.id, 1, 0);
    let impacts = 0;
    run(court, 1, () => (impacts += court.impacts.length));
    expect(ball.x).toBeLessThan(1.5);
    expect(impacts).toBeGreaterThan(0);
  });

  it("goes out past the side lines, as a ball does, and is reported with the balls that went", () => {
    const court = new Court(WIDTH, 40);
    const can = court.addCan(WIDTH + 0.2, 30, 0, CAN_BALLS, 0, false, stood);
    const id = can.id;
    expect(court.step()).toEqual([id]);
    expect(court.cans).toHaveLength(0);
  });

  it("names the can that went out by its seed, so the page can put it back in the bag", () => {
    const court = new Court(WIDTH, 40);
    court.addCan(WIDTH + 0.2, 30, 0, undefined, 2, false, stood);
    court.step();
    expect(court.cansGone).toEqual([2]);
    court.step();
    expect(court.cansGone).toEqual([]);
  });

  /** Carry a can to `(toX, toY)` over a second, hold it there 1.5 s, and report how far a corner of it ever went past the walls and the floor, and how far it turned. */
  function carryAndHold(startX: number, toX: number, toY: number, floor = 0) {
    const court = new Court(WIDTH, HEIGHT, [], [], floor);
    const can = court.addCan(startX, floor + CAN_HEIGHT / 2 + 0.05, 0, CAN_BALLS, 0, false, stood);
    const top = floor + CAN_HEIGHT / 2 + 0.05 + CAN_HEIGHT * 0.4; // where a press takes it: by its top
    court.grabCan(can.id, { x: can.x, y: top });
    let pastWall = 0;
    let belowFloor = 0;
    let turned = 0;
    let angle = can.angle;
    const corners = () =>
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({
        x: can.x + (sx * CAN_WIDTH) / 2 * Math.cos(can.angle) - (sy * CAN_HEIGHT) / 2 * Math.sin(can.angle),
        y: can.y + (sx * CAN_WIDTH) / 2 * Math.sin(can.angle) + (sy * CAN_HEIGHT) / 2 * Math.cos(can.angle),
      }));
    const total = Math.round(2.5 / STEP);
    for (let i = 0; i < total; i++) {
      const p = Math.min(1, i / Math.round(1 / STEP));
      court.carryCan(can.id, { x: startX + (toX - startX) * p, y: top + (toY - top) * p });
      court.step();
      turned += Math.abs(can.angle - angle);
      angle = can.angle;
      if (i % Math.round(0.1 / STEP) === 0 || i === total - 1) {
        for (const c of corners()) {
          pastWall = Math.max(pastWall, -c.x, c.x - WIDTH);
          belowFloor = Math.max(belowFloor, floor - c.y);
        }
      }
    }
    return { court, can, pastWall, belowFloor, turns: turned / (2 * Math.PI) };
  }

  it("stays between the side walls while it is carried, with the pointer anywhere past them, and settles instead of spinning", () => {
    for (const side of [-1, 1]) {
      for (const past of [0.075, 0.225]) {
        // (0.075 and 0.225 m are about 40 and 120 px on a 1280 px window)
        const at = `${past} m past the ${side < 0 ? "left" : "right"} wall`;
        const { court, pastWall, turns } = carryAndHold(side < 0 ? 0.6 : WIDTH - 0.6, side < 0 ? -past : WIDTH + past, 0.6);
        expect(court.cans, `still on the court, pointer ${at}`).toHaveLength(1);
        expect(pastWall, `no corner more than 3 px (0.006 m) past the wall, pointer ${at}`).toBeLessThan(0.006);
        expect(turns, `less than one full turn, pointer ${at}`).toBeLessThan(1);
      }
    }
  });

  it("stays above the floor while it is carried, with the pointer just above the window's bottom, and lies on the court when let go", () => {
    for (const floor of [0, 0.056]) {
      // (0.056 m is the 30 px a touch screen lifts the floor; the pointer is 3 px above the floor, which is the bottom of the window)
      const { court, can, belowFloor } = carryAndHold(1.2, 1.2, floor + 0.006, floor);
      expect(belowFloor, `no corner more than 3 px below the floor, floor ${floor}`).toBeLessThan(0.006);
      court.releaseCan(can.id);
      run(court, 2);
      expect(court.cans, "still on the court").toHaveLength(1);
      expect(can.y, "standing on the floor, not under it").toBeGreaterThan(floor + CAN_HEIGHT / 2 - 0.01);
      expect(court.canState(can.id)).toBe("placed");
    }
  });

  it("stands on a lifted floor, not the window's bottom", () => {
    const court = new Court(WIDTH, HEIGHT, [], [], 0.056);
    const can = court.addCan(1, 0.8);
    run(court, 3);
    expect(can.y - CAN_HEIGHT / 2).toBeCloseTo(0.056, 2);
  });

  it("passes through what else stands in the open bag while it is lifted out, so a can drawn smaller than real is not thrown by its neighbours' lids", () => {
    const court = new Court(WIDTH, HEIGHT);
    const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    court.setBag([rect(0.8, 0.1, 1.4, 0.7)]);
    court.setSolids([rect(1.0, 0.45, 1.1, 0.5)]); // a lid right where the can's body is
    const can = court.addCan(1.05, 0.4, 0, CAN_BALLS, 0, true, stood);
    court.grabCan(can.id, { x: 1.05, y: 0.5 });
    court.carryCan(can.id, { x: 1.05, y: 0.5 });
    run(court, 0.3);
    expect(Math.abs(can.y - 0.4), "it stays where the hand holds it").toBeLessThan(0.02);
    expect(Math.abs(can.angle)).toBeLessThan(0.2);
  });

  it("is taken off the court by clearCans, even when it is in somebody's hand", () => {
    const court = new Court(WIDTH, HEIGHT);
    const can = court.addCan(1, CAN_HEIGHT / 2);
    court.grabCan(can.id, { x: 1, y: 0.15 });
    court.clearCans();
    expect(court.cans).toHaveLength(0);
    run(court, 0.5); // nothing is left holding on to a can that is gone
  });
});

describe("the scene on a phone", () => {
  const PHONES = [
    [750, 280],
    [844, 390],
    [863, 360],
    [1280, 800],
    [1920, 1080],
  ];

  it("lets the open bag sink what is in it by at most 45 mm, whatever the window, with the floor lifted or not", () => {
    for (const [w, h] of PHONES) {
      for (const lift of [0, 30]) {
        const { L } = courtWithScene(w, h, lift);
        expect(L.sink, `sink at ${w}x${h}, lift ${lift}`).toBeLessThanOrEqual(45 + 1e-6);
      }
    }
  });

  it("is drawn about 58 percent of real size at 750 x 280, with the cans and the notebook coming furthest out", () => {
    const { L } = courtWithScene(750, 280, 30);
    expect(L.scale).toBeGreaterThan(0.54);
    expect(L.scale).toBeLessThan(0.62);
    expect(L.sink).toBeCloseTo(45, 0);
  });

  it("draws the scene about 0.84 of real size at 844 x 390 and 0.73 at 863 x 360 on a touch screen: the bench's front edge clears the lifted floor, no more", () => {
    expect(courtWithScene(844, 390, 30).L.scale).toBeCloseTo(0.84, 1);
    expect(courtWithScene(863, 360, 30).L.scale).toBeCloseTo(0.73, 1);
    expect(courtWithScene(750, 280, 30).L.scale).toBeCloseTo(0.58, 1);
    const { L } = courtWithScene(750, 280, 30);
    expect(L.shows * L.k, "the bench shows 30 px of its front, the lift").toBeCloseTo(30, 0);
  });

  it("shows enough of the bench on a touch screen that its front edge is at or above the lifted floor, and a ball over the seat still rests on the seat", () => {
    for (const [w, h] of PHONES) {
      const lift = 30;
      const { L, court, px, toM } = courtWithScene(w, h, lift);
      expect(L.benchFrontTop, `the bench's front edge is at or above the lifted floor at ${w}x${h}`).toBeLessThanOrEqual(h - lift + 0.01);
      expect(L.benchSurfaceY, `the seat line is above the lifted floor at ${w}x${h}`).toBeLessThan(h - lift - 5);
      const x = L.benchX + 150 * L.k * 2; // clear seat left of the bag
      const at = toM([x, L.benchSurfaceY - 200]);
      const ball = court.addBall(at.x, at.y, false);
      run(court, 6);
      const underside = h - (ball.y - RADIUS) * px;
      expect(Math.abs(underside - L.benchSurfaceY), `a ball rests on the seat at ${w}x${h}`).toBeLessThan(1);
    }
  });

  it("lets a ball on the lifted floor beside the bench rest on that floor, below the bench's seat line", () => {
    for (const [w, h] of PHONES) {
      const lift = 30;
      const { L, court, px, toM } = courtWithScene(w, h, lift);
      const at = toM([L.benchX - 60 * L.k, h - lift - 200]);
      const ball = court.addBall(at.x, at.y, false);
      run(court, 6);
      const underside = h - (ball.y - RADIUS) * px;
      expect(underside, `it rests on the floor at ${w}x${h}`).toBeCloseTo(h - lift, 0);
      expect(underside, `below the seat line at ${w}x${h}`).toBeGreaterThan(L.benchSurfaceY + 5);
    }
  });

  it("stops a ball rolling along the lifted floor into the bench's left end against it, not onto the seat", () => {
    for (const [w, h] of PHONES) {
      const lift = 30;
      const { L, court, px, toM } = courtWithScene(w, h, lift);
      const from = toM([L.benchX - 300 * L.k, h - lift - RADIUS * px]);
      const ball = court.addBall(from.x, from.y, false, 1.5, 0);
      let highest = -Infinity; // the highest the ball's underside got above the floor, px
      let furthest = ball.x;
      run(court, 4, () => {
        highest = Math.max(highest, h - lift - (h - (ball.y - RADIUS) * px));
        furthest = Math.max(furthest, ball.x);
      });
      expect(highest, `it never climbs the end, half way to the seat or more, at ${w}x${h}`).toBeLessThan((h - lift - L.benchSurfaceY) / 2);
      expect(furthest * px, `it stays left of the bench's front left corner's end face at ${w}x${h}`).toBeLessThan(sceneSolids(L).bench[4][0] + 1);
      expect(ball.x * px, `it ends beside the end at ${w}x${h}`).toBeLessThan(L.benchX + 150 * L.k * 1.5);
    }
  });
});
