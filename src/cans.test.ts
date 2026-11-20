// The bench, the bag, the notebook and the cans of balls as the court treats them: what a ball lands on, when a can lets its balls out,
// how many balls there can be, and how a can is carried and thrown. The page's own checks of the same things are in e2e/bench-bag.spec.ts.

import { afterEach, describe, expect, it } from "vitest";
import { CAN_BALLS, CAN_COUNT, CAN_HEIGHT, isTipped, mouthDirection, tiltOf } from "./cans";
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
function courtWithScene(w = 1280, h = 800) {
  const name = layoutName(w, h, WORDMARKS.ubuntu, params.ballScale);
  const L = sceneLayout(w, h, name);
  const px = name.ballPx / params.ballDiameter;
  const toM = ([x, y]: P): { x: number; y: number } => ({ x: x / px, y: (h - y) / px });
  const solids = sceneSolids(L);
  const court = new Court(w / px, h / px, [], [], 0, [solids.bench.map(toM)]);
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

  it("flies off when hit, the way a ball does", () => {
    const court = new Court(WIDTH, HEIGHT);
    const can = court.addCan(1, CAN_HEIGHT / 2);
    params.hitSpeed = 3;
    court.hit(can.id, 0, 1);
    court.step();
    expect(can.vy).toBeGreaterThan(2.5);
    expect(Math.abs(can.vx)).toBeLessThan(0.1);
  });

  it("goes out past the side lines, as a ball does, and is reported with the balls that went", () => {
    const court = new Court(WIDTH, 40);
    const can = court.addCan(WIDTH + 0.2, 30);
    const id = can.id;
    expect(court.step()).toEqual([id]);
    expect(court.cans).toHaveLength(0);
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

describe("balls from the cans and the limit on balls", () => {
  /** Sixty loose balls in a grid, oldest first, well clear of each other, and a tall room to pour in. */
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
  it("steps a court with the bench and the bag, 60 balls and all three cans poured out much faster than real time, so that 60 frames a second is easy", () => {
    // At 60 frames a second there are 16.7 ms to a frame, in which the court steps 4 times (240 steps a second). This runs one simulated
    // second, 240 steps, which at the pace of a frame takes 1 s of real time; it is given 250 ms, which is 4 times faster than that and still
    // far above what it takes (a few tens of ms), so that a busy machine does not fail it, and a step that has become slow does.
    const { solids, toM } = courtWithScene();
    const court = new Court(WIDTH, 5, [], [], 0, [solids.bench.map(toM)]); // tall, so that the cans pour in the air
    court.setBag([solids.bag.map(toM)]);
    for (let i = 0; i < MAX_BALLS - CAN_COUNT * CAN_BALLS; i++) court.addBall(0.1 + (i % 12) * 0.1, 0.3 + Math.floor(i / 12) * 0.1, false);
    for (let i = 0; i < CAN_COUNT; i++) court.addCan(0.5 + i * 0.3, 4.5, deg(130));
    run(court, 1); // pour all nine, each making room for itself in a court that is full
    expect(court.cans.reduce((sum, can) => sum + can.ballsLeft, 0)).toBe(0);
    expect(court.balls).toHaveLength(MAX_BALLS);
    const started = performance.now();
    run(court, 1);
    const took = performance.now() - started;
    expect(took, `one simulated second took ${took.toFixed(0)} ms`).toBeLessThan(250);
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
