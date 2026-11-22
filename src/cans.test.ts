// The bench, the bag, the notebook and the cans of balls as the court treats them: what a ball lands on, when a can lets its balls out,
// how many balls there can be, and how a can is carried and thrown. The page's own checks of the same things are in e2e/bench-bag.spec.ts.

import { afterEach, describe, expect, it } from "vitest";
import { CAN_BALLS, CAN_COUNT, CAN_HEIGHT, CAN_WIDTH, isTipped, mouthDirection, tiltOf } from "./cans";
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
  });

  it("lands upright when it drops from a height, and is still full", () => {
    const court = new Court(WIDTH, HEIGHT);
    const can = court.addCan(1, 0.9);
    run(court, 3);
    expect(tiltOf(can.angle)).toBeLessThan(2);
    expect(can.ballsLeft).toBe(CAN_BALLS);
    expect(court.balls).toHaveLength(0);
  });

  it("keeps its balls for as long as it is upright, however long that is, even in the air", () => {
    const court = new Court(WIDTH, 40); // a window so tall that the can is still falling after 2 s
    const can = court.addCan(1, 30);
    run(court, 2);
    expect(can.y).toBeLessThan(30);
    expect(can.ballsLeft).toBe(CAN_BALLS);
    expect(court.balls).toHaveLength(0);
  });

  it("keeps its balls when it is tipped less far than canPourAngle", () => {
    const court = new Court(WIDTH, 40);
    const can = court.addCan(1, 30, deg(params.canPourAngle - 10));
    run(court, 1.5);
    expect(can.ballsLeft).toBe(CAN_BALLS);
    expect(court.balls).toHaveLength(0);
  });

  it("pours its balls out one after another when it is tipped further than canPourAngle", () => {
    const court = new Court(WIDTH, 40);
    const can = court.addCan(1, 30, deg(params.canPourAngle + 20));
    run(court, 1);
    expect(court.balls).toHaveLength(CAN_BALLS);
    expect(can.ballsLeft).toBe(0);
    expect(new Set(court.balls.map((b) => b.id)).size).toBe(CAN_BALLS);
  });

  it("lets a ball out each canPourInterval, the first one that long after it tips", () => {
    params.canPourInterval = 0.2;
    const court = new Court(WIDTH, 40);
    const can = court.addCan(1, 30, deg(130));
    run(court, 0.19);
    expect(court.balls).toHaveLength(0);
    run(court, 0.03); // 0.22 s: past the first interval
    expect(court.balls).toHaveLength(1);
    expect(can.ballsLeft).toBe(CAN_BALLS - 1);
    run(court, 0.14); // 0.36 s: short of the second, which is due 0.2 s after the first
    expect(court.balls).toHaveLength(1);
    run(court, 0.07); // 0.43 s
    expect(court.balls).toHaveLength(2);
  });

  it("lets balls out of its mouth, along the way the mouth points", () => {
    params.canPourSpeed = 1;
    const court = new Court(WIDTH, 40);
    const angle = deg(125);
    const can = court.addCan(1, 30, angle);
    run(court, params.canPourInterval + 0.01);
    expect(court.balls).toHaveLength(1);
    const ball = court.balls[0];
    const mouth = mouthDirection(angle);
    // The ball is past the can's mouth, on the line the mouth points along (to within the can's own width)...
    const along = (ball.x - can.x) * mouth.x + (ball.y - can.y) * mouth.y;
    expect(along).toBeGreaterThan(CAN_HEIGHT / 2);
    expect(Math.abs((ball.x - can.x) * mouth.y - (ball.y - can.y) * mouth.x)).toBeLessThan(0.01);
    // ...and moving that way, and not at the can's own pace: the can is falling, so is the ball, and what is left is the pour.
    const relative = { x: ball.vx - can.vx, y: ball.vy - can.vy };
    expect(relative.x * mouth.x + relative.y * mouth.y).toBeGreaterThan(0.5);
  });

  it("pours a can that is tipped the other way too", () => {
    const court = new Court(WIDTH, 40);
    const can = court.addCan(1, 30, deg(-130));
    run(court, 1);
    expect(can.ballsLeft).toBe(0);
    expect(court.balls).toHaveLength(CAN_BALLS);
  });

  it("stays full when it is mouth down on the floor, where the floor blocks its mouth", () => {
    const court = new Court(WIDTH, HEIGHT);
    const can = court.addCan(1, CAN_HEIGHT / 2, Math.PI);
    run(court, 2);
    expect(isTipped(can.angle, params.canPourAngle)).toBe(true);
    expect(can.ballsLeft).toBe(CAN_BALLS);
    expect(court.balls).toHaveLength(0);
  });

  it("stays full when it is lying on its side on the floor, which is short of pouring", () => {
    const court = new Court(WIDTH, HEIGHT);
    const can = court.addCan(1, 0.0391, deg(90));
    run(court, 3);
    expect(can.ballsLeft).toBe(CAN_BALLS);
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

  it("is not knocked by a hit: a tap on a can leaves it where it was", () => {
    const court = new Court(WIDTH, HEIGHT);
    const can = court.addCan(1, CAN_HEIGHT / 2);
    params.hitSpeed = 3;
    court.hit(can.id, 0, 1);
    run(court, 0.5);
    expect(Math.abs(can.vy)).toBeLessThan(0.05);
    expect(can.x).toBeCloseTo(1, 2);
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
    court.addCan(1.5, CAN_HEIGHT / 2);
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
    const can = court.addCan(WIDTH + 0.2, 30);
    const id = can.id;
    expect(court.step()).toEqual([id]);
    expect(court.cans).toHaveLength(0);
  });

  it("names the can that went out by its seed, so the page can put it back in the bag", () => {
    const court = new Court(WIDTH, 40);
    court.addCan(WIDTH + 0.2, 30, 0, undefined, 2);
    court.step();
    expect(court.cansGone).toEqual([2]);
    court.step();
    expect(court.cansGone).toEqual([]);
  });

  /** Carry a can to `(toX, toY)` over a second, hold it there 1.5 s, and report how far a corner of it ever went past the walls and the floor, and how far it turned. */
  function carryAndHold(startX: number, toX: number, toY: number, floor = 0) {
    const court = new Court(WIDTH, HEIGHT, [], [], floor);
    const can = court.addCan(startX, floor + CAN_HEIGHT / 2 + 0.05);
    court.grab(can.id, { x: can.x, y: can.y + CAN_HEIGHT * 0.4 }); // by its top, as a press does
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
      court.carryTo(startX + (toX - startX) * p, can.y * 0 + (floor + CAN_HEIGHT / 2 + 0.05 + CAN_HEIGHT * 0.4) + (toY - (floor + CAN_HEIGHT / 2 + 0.05 + CAN_HEIGHT * 0.4)) * p);
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
      court.release();
      run(court, 2);
      expect(court.cans, "still on the court").toHaveLength(1);
      expect(can.y, "lying on the court, not under it").toBeGreaterThan(floor);
    }
  });

  it("passes through what else stands in the open bag while it is lifted out, so a can drawn smaller than real is not thrown by its neighbours' lids", () => {
    const court = new Court(WIDTH, HEIGHT);
    const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    court.setBag([rect(0.8, 0.1, 1.4, 0.7)]);
    court.setSolids([rect(1.0, 0.45, 1.1, 0.5)]); // a lid right where the can's body is
    const can = court.addCan(1.05, 0.4, 0, CAN_BALLS, 0, true);
    court.grab(can.id, { x: 1.05, y: 0.5 });
    run(court, 0.3);
    expect(Math.abs(can.y - 0.4), "it stays where the hand holds it").toBeLessThan(0.02);
    expect(Math.abs(can.angle)).toBeLessThan(0.2);
  });

  it("is taken off the court by clearCans, even when it is in somebody's hand", () => {
    const court = new Court(WIDTH, HEIGHT);
    const can = court.addCan(1, CAN_HEIGHT / 2);
    court.grab(can.id, { x: 1, y: 0.15 });
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

  it("is drawn about 66 percent of real size at 750 x 280, with the cans and the notebook coming further out", () => {
    const { L } = courtWithScene(750, 280, 30);
    expect(L.scale).toBeGreaterThan(0.6);
    expect(L.scale).toBeLessThan(0.72);
    expect(L.sink).toBeCloseTo(45, 0);
  });

  it("draws the scene about 0.95 of real size at 844 x 390 and 0.82 at 863 x 360 on a touch screen: halfway out, not smaller than the seat needs", () => {
    expect(courtWithScene(844, 390, 30).L.scale).toBeCloseTo(0.948, 1);
    expect(courtWithScene(863, 360, 30).L.scale).toBeCloseTo(0.82, 1);
    expect(courtWithScene(750, 280, 30).L.scale).toBeCloseTo(0.656, 1);
    expect(courtWithScene(750, 280, 30).L.shows, "the seat rule makes it show about 95 mm").toBeCloseTo(95.5, 0);
  });

  it("shows enough of the bench on a touch screen that a ball over the seat rests on the seat, within 1 px", () => {
    for (const [w, h] of PHONES) {
      const lift = 30;
      const { L, court, px, toM } = courtWithScene(w, h, lift);
      expect(L.benchSurfaceY, `the seat line is at or above the lifted floor at ${w}x${h}`).toBeLessThanOrEqual(h - lift + 0.01);
      const x = L.benchX + 150 * L.k * 2; // clear seat left of the bag
      const at = toM([x, L.benchSurfaceY - 200]);
      const ball = court.addBall(at.x, at.y, false);
      run(court, 6);
      const underside = h - (ball.y - RADIUS) * px;
      expect(Math.abs(underside - L.benchSurfaceY), `a ball rests on the seat at ${w}x${h}`).toBeLessThan(1);
    }
  });
});

describe("the bench's ends", () => {
  /** A ball thrown at `speed` m/s into the bench's left end, half way up its face: the fastest it comes back off it, m/s, in 1 s. */
  function comeBack(speed: number): number {
    const { court, solids, toM } = courtWithScene();
    const left = solids.bench[4]; // the outline's front left corner, page px: its face runs straight down from here
    const face = toM([left[0], (left[1] + solids.bench[3][1]) / 2]);
    const ball = court.addBall(face.x - RADIUS - 0.15, face.y, false, speed, 0);
    let back = 0;
    run(court, 1, () => (back = Math.max(back, -ball.vx)));
    return back;
  }

  it("is only 10 percent as lively as the seat: a ball thrown into the left end barely comes back", () => {
    expect(params.benchEndRestitution).toBe(0.1);
    const back = comeBack(3);
    expect(back).toBeLessThan(0.1 * 3 + 0.3); // 0.1 of its speed, with a little for the sweep of the spin
    expect(back).toBeLessThan(0.78 * 3 * 0.5); // where the usual bounce would send it back at over half its speed
  });

  it("is as lively as the usual bounce when benchEndRestitution is raised to it", () => {
    params.benchEndRestitution = params.restitution;
    expect(comeBack(3)).toBeGreaterThan(0.78 * 3 * 0.5);
  });

  it("leaves the seat's bounce alone: a ball dropped on it comes back up at more than half its speed", () => {
    const { L, court, toM } = courtWithScene();
    const at = toM([L.benchX + 400 * L.k, L.benchSurfaceY - 400]);
    const ball = court.addBall(at.x, at.y, false);
    let down = 0;
    let up = 0;
    run(court, 1, () => {
      down = Math.max(down, -ball.vy);
      if (ball.vy > 0 && down > 1) up = Math.max(up, ball.vy);
    });
    expect(up).toBeGreaterThan(down * 0.5);
  });

  it("stops a ball beside the left end 150 mm back: the outline's left side runs from the seat line forward to there, then straight down", () => {
    const { L, solids } = courtWithScene();
    const [seat, , , bottomLeft, corner] = solids.bench;
    expect(corner[0]).toBeCloseTo(L.benchX + 150 * Math.cos(deg(40)) * 0.35 * L.k, 0); // 150 mm back, drawn at 0.35 of its length, 40 degrees
    expect(corner[1]).toBeCloseTo(L.benchFrontTop - 150 * Math.sin(deg(40)) * 0.35 * L.k, 0);
    expect(corner[0]).toBeLessThan(seat[0]); // short of the seat's half way line, so a ball can come nearer the front
    expect(bottomLeft[0]).toBe(corner[0]); // straight down from the corner
  });
});

describe("balls from the cans and the limit on balls", () => {
  it("is at most 20 balls", () => {
    expect(MAX_BALLS).toBe(20);
  });

  /** MAX_BALLS loose balls in a grid, oldest first, well clear of each other, and a tall room to pour in. */
  function fullCourt() {
    const court = new Court(WIDTH, 20);
    for (let i = 0; i < MAX_BALLS; i++) court.addBall(0.1 + (i % 20) * 0.1, 0.1 + Math.floor(i / 20) * 0.1, false);
    return court;
  }

  it("counts a poured ball toward the limit: the oldest loose ball makes way for it", () => {
    const court = fullCourt();
    const oldest = court.balls.map((b) => b.id).slice(0, 3);
    const youngest = court.balls[MAX_BALLS - 1].id;
    const can = court.addCan(1.2, 15, deg(130));
    expect(court.balls).toHaveLength(MAX_BALLS);
    run(court, params.canPourInterval + 0.01);
    expect(can.ballsLeft).toBe(CAN_BALLS - 1);
    expect(court.balls).toHaveLength(MAX_BALLS);
    expect(court.balls.map((b) => b.id)).not.toContain(oldest[0]);
    expect(court.balls.map((b) => b.id)).toContain(oldest[1]);
    expect(court.balls.map((b) => b.id)).toContain(youngest);
  });

  it("never takes a ball that is still inside a can to make way: the balls in cans are not on the court to be taken", () => {
    const court = fullCourt();
    const cans = Array.from({ length: CAN_COUNT }, (_, i) => court.addCan(0.4 + i * 0.5, 15, i === 0 ? deg(130) : 0));
    const [tipped, ...upright] = cans;
    run(court, 1); // the tipped can empties itself, 3 balls, into a full court
    expect(tipped.ballsLeft).toBe(0);
    expect(court.balls).toHaveLength(MAX_BALLS);
    // 3 balls came out of the first can and 3 loose ones made way; the full cans lost nothing...
    for (const can of upright) expect(can.ballsLeft).toBe(CAN_BALLS);
    // ...and every ball that made way was a loose one, the oldest first.
    const poured = court.balls.filter((b) => b.id > MAX_BALLS);
    expect(poured).toHaveLength(CAN_BALLS);
    expect(court.balls.slice(0, MAX_BALLS - CAN_BALLS).map((b) => b.id)).toEqual(Array.from({ length: MAX_BALLS - CAN_BALLS }, (_, i) => i + 1 + CAN_BALLS));
  });

  it("does not take the ball in somebody's hand, or a dot, to make way", () => {
    const court = new Court(WIDTH, 20);
    const dot = court.addBall(0.1, 10, true);
    const held = court.addBall(0.3, 10, false);
    court.grab(held.id);
    for (let i = 0; i < MAX_BALLS - 2; i++) court.addBall(0.1 + (i % 20) * 0.1, 0.1 + Math.floor(i / 20) * 0.1, false);
    expect(court.balls).toHaveLength(MAX_BALLS);
    court.makeRoom();
    expect(court.balls).toHaveLength(MAX_BALLS - 1);
    expect(court.balls.map((b) => b.id)).toContain(dot.id);
    expect(court.balls.map((b) => b.id)).toContain(held.id);
  });

  it("lets all three cans pour all nine balls in a court that is not full, and every one is a real ball", () => {
    const court = new Court(WIDTH, 40);
    for (let i = 0; i < CAN_COUNT; i++) court.addCan(0.4 + i * 0.5, 30, deg(130));
    run(court, 1);
    expect(court.cans.reduce((sum, can) => sum + can.ballsLeft, 0)).toBe(0);
    expect(court.balls).toHaveLength(CAN_COUNT * CAN_BALLS);
  });
});

describe("a can in the hand", () => {
  /** Press on a can at `at`, drag the pointer to `to` over `seconds`, and keep going until `then` seconds have passed in all. */
  function drag(court: Court, can: { id: number }, at: { x: number; y: number }, to: { x: number; y: number }, seconds: number, watch?: () => void) {
    court.grab(can.id, at);
    const steps = Math.round(seconds / STEP);
    for (let i = 1; i <= steps; i++) {
      court.carryTo(at.x + ((to.x - at.x) * i) / steps, at.y + ((to.y - at.y) * i) / steps);
      court.step();
      watch?.();
    }
  }

  it("follows the pointer: carried by its upper half it hangs just under the pointer, upright, and still full", () => {
    const court = new Court(4, 4);
    const can = court.addCan(1, CAN_HEIGHT / 2);
    run(court, 1);
    const at = { x: 1, y: CAN_HEIGHT * 0.75 };
    const to = { x: 2.6, y: 1.8 };
    let mostTipped = 0;
    drag(court, can, at, to, 2.5, () => (mostTipped = Math.max(mostTipped, tiltOf(can.angle))));
    run(court, 1);
    expect(can.held).toBe(true);
    // It hangs from the point it was taken by, which is now at the pointer: the can's middle is a quarter of its height below it.
    expect(Math.hypot(can.x - to.x, can.y + CAN_HEIGHT / 4 - to.y)).toBeLessThan(0.03);
    expect(tiltOf(can.angle)).toBeLessThan(10);
    expect(mostTipped, "a gentle carry does not tip it").toBeLessThan(40);
    expect(can.ballsLeft).toBe(CAN_BALLS);
    expect(court.balls).toHaveLength(0);
  });

  it("is let go by release, and falls", () => {
    const court = new Court(4, 4);
    const can = court.addCan(1, CAN_HEIGHT / 2);
    drag(court, can, { x: 1, y: 0.15 }, { x: 1, y: 1.5 }, 1);
    run(court, 0.5);
    expect(can.y).toBeGreaterThan(1);
    court.release();
    expect(can.held).toBe(false);
    run(court, 2);
    expect(can.y).toBeLessThan(0.5);
    expect(tiltOf(can.angle)).toBeLessThan(5);
  });

  it("is thrown by letting go while it is moving: it keeps going the way it was", () => {
    const court = new Court(8, 4);
    const can = court.addCan(1, 1.5); // already up in the air, taken where it is
    drag(court, can, { x: 1, y: 1.55 }, { x: 5, y: 1.55 }, 0.8);
    expect(can.vx).toBeGreaterThan(1);
    const before = { x: can.x, vx: can.vx };
    court.release();
    run(court, 0.1);
    expect(can.held).toBe(false);
    expect(can.x).toBeGreaterThan(before.x);
    expect(can.vx).toBeGreaterThan(before.vx * 0.7);
  });

  it("goes no faster than a carried ball does, however fast the pointer", () => {
    const court = new Court(40, 40);
    const can = court.addCan(1, 20);
    court.grab(can.id, { x: 1, y: 20 });
    let fastest = 0;
    for (let i = 0; i < 480; i++) {
      court.carryTo(1 + i * 0.05, 20); // the pointer runs at 12 m/s
      court.step();
      fastest = Math.max(fastest, Math.hypot(can.vx, can.vy));
    }
    expect(fastest).toBeLessThanOrEqual(params.carrySpeed + 1e-6);
    expect(fastest).toBeGreaterThan(params.carrySpeed * 0.9);
  });

  it("turns over and pours when it is taken by its base and the hand lets it hang", () => {
    params.canGrip = 0; // no hand keeping it upright: a can taken below its weight hangs mouth down
    const court = new Court(4, 4);
    const can = court.addCan(1, 1);
    drag(court, can, { x: 1, y: 1 - CAN_HEIGHT * 0.45 }, { x: 1.5, y: 2 }, 1.5);
    run(court, 1);
    expect(can.ballsLeft).toBe(0);
    expect(court.balls).toHaveLength(CAN_BALLS);
  });

  it("is kept upright by the hand's grip, more firmly the more canGrip there is", () => {
    // The same tug: the pointer jumps 0.4 m sideways in a tenth of a second, and the can hangs from its top. The less the grip, the further it swings.
    // (At 0.5 m this can turns right over whatever the grip, and the comparison says nothing: 0.4 m is a hard tug it can still be seen to resist.)
    const mostTipped = (grip: number) => {
      params.canGrip = grip;
      const court = new Court(4, 4);
      const can = court.addCan(1, 2);
      let most = 0;
      drag(court, can, { x: 1, y: 2 + CAN_HEIGHT * 0.4 }, { x: 1.4, y: 2 + CAN_HEIGHT * 0.4 }, 0.1, () => (most = Math.max(most, tiltOf(can.angle))));
      run(court, 0.5, () => (most = Math.max(most, tiltOf(can.angle))));
      return most;
    };
    expect(mostTipped(0)).toBeGreaterThan(mostTipped(70));
    expect(mostTipped(70)).toBeGreaterThan(mostTipped(150));
  });
});

describe("the cost of all of it", () => {
  // At 60 frames a second there are 16.7 ms to a frame, in which the court steps 4 times (240 steps a second), so one simulated second
  // is 240 steps and, at the pace of a frame, 1 s of real time. What those steps cost was measured, not guessed: 60 balls falling and
  // bouncing, all moving, take about 20 ms in a court that is bare (the court of the first draft). With the bench and the bag in it
  // they take about 75 ms, and with the three cans pouring as well about 90 ms. The bench and the bag cost the same whatever their
  // outline (a 4-point bench as much as the bag's 141 points): what grows is the continuous-collision work (planck's TimeOfImpact and
  // Distance) of balls meeting more shapes while they are all moving. That is under 2 ms of a frame's 16.7, so it is left as it is.
  const FALL = 1.0; // m; the balls start above everything standing on the floor, so none of them starts inside the bench or the bag

  function fullCourt(solidsAndCans: boolean) {
    const { solids, toM } = courtWithScene();
    const court = solidsAndCans
      ? new Court(WIDTH, 5, [], [], 0, [solids.bench.map(toM)]) // tall, so that the cans pour in the air
      : new Court(WIDTH, 5);
    if (solidsAndCans) court.setBag([solids.bag.map(toM)]);
    const loose = solidsAndCans ? MAX_BALLS - CAN_COUNT * CAN_BALLS : MAX_BALLS;
    for (let i = 0; i < loose; i++) court.addBall(0.1 + (i % 12) * 0.1, FALL + Math.floor(i / 12) * 0.1, false);
    if (solidsAndCans) for (let i = 0; i < CAN_COUNT; i++) court.addCan(0.5 + i * 0.3, 4.5, deg(130));
    run(court, 1); // pour all nine, each making room for itself in a court that is full
    return court;
  }

  /** How long one simulated second takes, in ms: the best of several, so that a busy machine (the other tests run alongside) does not count. */
  function secondTakes(solidsAndCans: boolean): number {
    let best = Infinity;
    for (let attempt = 0; attempt < 5; attempt++) {
      const court = fullCourt(solidsAndCans);
      const started = performance.now();
      run(court, 1);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  }

  it("steps a court with the bench and the bag, 60 balls and all three cans poured out much faster than real time, so that 60 frames a second is easy", () => {
    const court = fullCourt(true);
    expect(court.cans.reduce((sum, can) => sum + can.ballsLeft, 0)).toBe(0);
    expect(court.balls).toHaveLength(MAX_BALLS);
    const took = secondTakes(true);
    expect(took, `one simulated second took ${took.toFixed(0)} ms`).toBeLessThan(250); // 4 times faster than real time
  });

  it("costs no more than a few times what the same balls cost in a bare court, so that a step that has become slow is seen on any machine", () => {
    const bare = secondTakes(false);
    const full = secondTakes(true);
    expect(full, `${full.toFixed(0)} ms against ${bare.toFixed(0)} ms bare`).toBeLessThan(bare * 8); // about 4.5 times when measured
  });
});

describe("a can lifted out of the bag", () => {
  it("passes through the bag's outline while it is being lifted out, and is solid to it once it is clear", () => {
    const { L, court, toM } = courtWithScene();
    const inside = toM([L.bagAt[0] + 60 * L.k, L.bagAt[1] - 100 * L.k]); // standing in the bag, over the front's top edge
    const can = court.addCan(inside.x, inside.y, 0, CAN_BALLS, 1, true);
    expect(court.isEmerging(can.id)).toBe(true);
    court.grab(can.id, inside);
    const above = toM([L.bagAt[0] + 60 * L.k, L.bagAt[1] - 900 * L.k]);
    court.carryTo(above.x, above.y);
    run(court, 1);
    expect(can.y).toBeGreaterThan(inside.y + 0.1); // it went up through the outline
    expect(court.isEmerging(can.id)).toBe(false); // and is clear of it now
  });

  it("is not emerging when it was never in the bag", () => {
    const court = new Court(WIDTH, HEIGHT);
    const can = court.addCan(1, 0.5);
    expect(court.isEmerging(can.id)).toBe(false);
  });
});

describe("the cans standing on the floor", () => {
  it("stands each of three on the floor, where it stays upright and full", () => {
    const court = new Court(WIDTH, HEIGHT);
    const cans = [0.4, 0.7, 1].map((x) => court.addCan(x, CAN_HEIGHT / 2));
    run(court, 3);
    for (const can of cans) {
      expect(tiltOf(can.angle)).toBeLessThan(1);
      expect(can.ballsLeft).toBe(CAN_BALLS);
    }
    expect(court.balls).toHaveLength(0);
  });
});
