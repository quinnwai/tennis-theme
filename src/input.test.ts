import { describe, expect, it } from "vitest";
import { Gestures, canGap, hitDirection, type CanView, type GestureActions, type Vec } from "./input";
import { params } from "./params";

const ball = { id: 1, x: 100, y: 100, r: 13 };

function setup() {
  const log: string[] = [];
  const last: { dir?: Vec } = {};
  const actions: GestureActions = {
    hit: (id, dir) => {
      log.push(`hit:${id}`);
      last.dir = dir;
    },
    grab: (id) => log.push(`grab:${id}`),
    carry: (at) => log.push(`carry:${at.x},${at.y}`),
    release: () => log.push("release"),
  };
  return { g: new Gestures(() => [ball], actions), log, last };
}

describe("hitDirection", () => {
  it("sends the ball up when tapped underneath", () => {
    const d = hitDirection(ball, { x: 100, y: 110 });
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(-1);
  });

  it("sends the ball up and to the right when tapped at its bottom left", () => {
    const d = hitDirection(ball, { x: 92, y: 108 });
    expect(d.x).toBeCloseTo(Math.SQRT1_2);
    expect(d.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it("sends the ball straight up when tapped dead center", () => {
    expect(hitDirection(ball, { x: 100.5, y: 100 })).toEqual({ x: 0, y: -1 });
  });
});

describe("Gestures", () => {
  it("treats a quick tap beside the ball as a hit from that side", () => {
    const { g, log, last } = setup();
    g.down(100, 125, 0); // below the ball, outside it but within reach
    g.up(90);
    expect(log).toEqual(["hit:1"]);
    expect(last.dir!.y).toBeCloseTo(-1);
  });

  it("ignores a tap far from any ball", () => {
    const { g, log } = setup();
    g.down(300, 300, 0);
    g.up(50);
    expect(log).toEqual([]);
  });

  it("picks the ball up when pressed and dragged, and lets it go on release", () => {
    const { g, log } = setup();
    g.down(102, 101, 0);
    g.move(120, 101);
    g.move(140, 101);
    g.up(62);
    expect(log).toEqual(["grab:1", "carry:120,101", "carry:140,101", "release"]);
  });

  it("picks the ball up when held still past the tap window", () => {
    const { g, log } = setup();
    g.down(100, 100, 0);
    g.tick(100);
    expect(log).toEqual([]);
    g.tick(300);
    expect(log).toEqual(["grab:1"]);
    g.up(900);
    expect(log).toEqual(["grab:1", "release"]);
  });

  it("does nothing for a drag that starts beside the ball rather than on it", () => {
    const { g, log } = setup();
    g.down(100, 128, 0);
    g.move(140, 128);
    g.up(60);
    expect(log).toEqual([]);
  });

  it("does not hit when a press beside the ball is held too long", () => {
    const { g, log } = setup();
    g.down(100, 128, 0);
    g.up(400);
    expect(log).toEqual([]);
  });

  it("says whether a press landed on a ball, so that the page knows if a gesture has begun", () => {
    const { g } = setup();
    expect(g.down(300, 300, 0)).toBe(false);
    expect(g.down(100, 125, 0)).toBe(true);
  });
});

// A finger covers the ball it presses and cannot say which pixel it means, so a touch has a bigger floor for how
// far from a ball's middle it still counts. These balls are small, as on a phone held sideways (a ball 21 px across
// there), where the floors are what decides: a mouse reaches 24 px to hit and 14 px to grab, a finger 32 and 22.
describe("Gestures with a finger", () => {
  const small = { id: 2, x: 100, y: 100, r: 8 };

  function touchSetup() {
    const log: string[] = [];
    const actions: GestureActions = {
      hit: (id) => log.push(`hit:${id}`),
      grab: (id) => log.push(`grab:${id}`),
      carry: (at) => log.push(`carry:${at.x},${at.y}`),
      release: () => log.push("release"),
    };
    return { g: new Gestures(() => [small], actions), log };
  }

  it("hits a ball from farther away than a mouse would", () => {
    const mouse = touchSetup();
    mouse.g.down(100, 128, 0); // 28 px under the middle: past a mouse's 24
    mouse.g.up(50);
    expect(mouse.log).toEqual([]);

    const finger = touchSetup();
    finger.g.down(100, 128, 0, true); // within a finger's 32
    finger.g.up(50);
    expect(finger.log).toEqual(["hit:2"]);
  });

  it("picks a ball up from farther away than a mouse would", () => {
    const mouse = touchSetup();
    mouse.g.down(100, 120, 0); // 20 px: past a mouse's 14, so a drag from here moves nothing
    mouse.g.move(140, 120);
    mouse.g.up(60);
    expect(mouse.log).toEqual([]);

    const finger = touchSetup();
    finger.g.down(100, 120, 0, true); // within a finger's 22
    finger.g.move(140, 120);
    finger.g.up(60);
    expect(finger.log).toEqual(["grab:2", "carry:140,120", "release"]);
  });

  it("uses the numbers in params.ts for the floors, so that the tuner can move them", () => {
    const saved = { hit: params.touchMinHitReachPx, grab: params.touchMinGrabReachPx };
    try {
      params.touchMinHitReachPx = 50;
      params.touchMinGrabReachPx = 40;
      const { g, log } = touchSetup();
      g.down(100, 145, 0, true); // 45 px: only a floor of 50 reaches it
      g.up(50);
      g.down(100, 135, 100, true); // 35 px: only a grab floor of 40 reaches it
      g.move(140, 135);
      g.up(160);
      expect(log).toEqual(["hit:2", "grab:2", "carry:140,135", "release"]);
    } finally {
      params.touchMinHitReachPx = saved.hit;
      params.touchMinGrabReachPx = saved.grab;
    }
  });

  it("still ignores a press well away from every ball", () => {
    const { g, log } = touchSetup();
    expect(g.down(100, 150, 0, true)).toBe(false); // 50 px
    g.up(50);
    expect(log).toEqual([]);
  });

  it("has a bigger floor than a mouse, and one that fits the 44 px a fingertip needs to be sure of a target", () => {
    expect(params.touchMinHitReachPx).toBeGreaterThan(params.minHitReachPx);
    expect(params.touchMinGrabReachPx).toBeGreaterThan(params.minGrabReachPx);
    expect(params.touchMinGrabReachPx * 2).toBeGreaterThanOrEqual(44);
    expect(params.touchMinHitReachPx).toBeGreaterThanOrEqual(params.touchMinGrabReachPx); // a tap's reach contains the grab's
  });
});

// ---- Cans ----

/** An upright can, 24 px across and 70 px tall, in the middle of the picture at (300, 300). */
const can: CanView = { id: 7, x: 300, y: 300, halfW: 12, halfH: 35, angle: 0 };

function setupWithCans(cans: CanView[], balls = [ball]) {
  const log: string[] = [];
  const last: { dir?: Vec; at?: Vec } = {};
  const actions: GestureActions = {
    hit: (id, dir, at) => {
      log.push(`hit:${id}`);
      last.dir = dir;
      last.at = at;
    },
    grab: (id, at) => log.push(`grab:${id}@${at.x},${at.y}`),
    carry: (at) => log.push(`carry:${at.x},${at.y}`),
    release: () => log.push("release"),
  };
  return { g: new Gestures(() => balls, actions, () => cans), log, last };
}

describe("canGap", () => {
  it("is 0 anywhere on or in the can", () => {
    expect(canGap(can, { x: 300, y: 300 })).toBe(0);
    expect(canGap(can, { x: 311, y: 334 })).toBe(0);
    expect(canGap(can, { x: 288, y: 265 })).toBeCloseTo(0, 10);
  });

  it("is the distance to the nearest side from beside it, and to the nearest corner from past a corner", () => {
    expect(canGap(can, { x: 320, y: 300 })).toBeCloseTo(8, 10); // 20 px from the middle, 12 px of it the can's half width
    expect(canGap(can, { x: 300, y: 350 })).toBeCloseTo(15, 10);
    expect(canGap(can, { x: 315, y: 343 })).toBeCloseTo(Math.hypot(3, 8), 10);
  });

  it("follows the can when it is turned: a can lying on its side is long across the picture", () => {
    const lying: CanView = { ...can, angle: Math.PI / 2 };
    expect(canGap(lying, { x: 330, y: 300 })).toBe(0); // 30 px along the can's length
    expect(canGap(lying, { x: 300, y: 320 })).toBeCloseTo(8, 10); // 20 px off its axis, its width being 12
    const tilted: CanView = { ...can, angle: Math.PI / 4 };
    const tip = { x: 300 + 35 * Math.sin(Math.PI / 4) * 0.99, y: 300 - 35 * Math.cos(Math.PI / 4) * 0.99 }; // just inside its mouth end
    expect(canGap(tilted, tip)).toBeCloseTo(0, 5);
  });
});

describe("Gestures with cans", () => {
  it("hits a can that is tapped, from the side that was tapped", () => {
    const { g, log, last } = setupWithCans([can]);
    expect(g.down(300, 325, 0)).toBe(true); // low on the can, a little to one side
    g.up(80);
    expect(log).toEqual(["hit:7"]);
    expect(last.dir!.y).toBeLessThan(-0.9); // sent up, away from the tap
  });

  it("picks a can up when it is pressed and dragged, taking it where it was pressed, and lets it go on release", () => {
    const { g, log } = setupWithCans([can]);
    g.down(302, 280, 0);
    g.move(330, 280);
    g.move(360, 250);
    g.up(80);
    expect(log).toEqual(["grab:7@302,280", "carry:330,280", "carry:360,250", "release"]);
  });

  it("picks a can up when it is held still past the tap window, and lifting it again is not a hit", () => {
    const { g, log } = setupWithCans([can]);
    g.down(300, 300, 0);
    g.tick(300);
    g.up(900);
    expect(log).toEqual(["grab:7@300,300", "release"]);
  });

  it("takes a press on the can for the can, even with a ball within reach of it", () => {
    const nearby = { id: 1, x: 300, y: 300, r: 13 }; // a ball right on the can, as one resting against it would be
    const { g, log } = setupWithCans([can], [nearby]);
    g.down(300, 300, 0);
    g.up(50);
    expect(log).toEqual(["hit:7"]);
  });

  it("takes a press beside the can for the ball, when a ball is in reach and the can is not under the press", () => {
    const beside = { id: 1, x: 340, y: 300, r: 13 }; // 28 px right of the can's middle: its side is at 312, so 328 is clear of it
    const { g, log } = setupWithCans([can], [beside]);
    g.down(330, 300, 0);
    g.up(50);
    expect(log).toEqual(["hit:1"]);
  });

  it("takes a press just outside the can, within a hold's reach, for the can: a mouse is 14 px, a finger 22", () => {
    const edge = 300 + can.halfW; // the can's right side
    const mouse = setupWithCans([can]);
    expect(mouse.g.down(edge + params.minGrabReachPx - 1, 300, 0)).toBe(true);
    expect(setupWithCans([can]).g.down(edge + params.minGrabReachPx + 1, 300, 0)).toBe(false);

    const finger = setupWithCans([can]);
    expect(finger.g.down(edge + params.touchMinGrabReachPx - 1, 300, 0, true)).toBe(true);
    expect(setupWithCans([can]).g.down(edge + params.touchMinGrabReachPx + 1, 300, 0, true)).toBe(false);
  });

  it("leaves a press far from every can and ball alone", () => {
    const { g, log } = setupWithCans([can]);
    expect(g.down(500, 500, 0)).toBe(false);
    g.up(50);
    expect(log).toEqual([]);
  });

  it("gives a press between two cans to the one whose side is nearer", () => {
    const left = { ...can, id: 8, x: 270 }; // spans 258 to 282; the other, id 7, spans 288 to 312
    const nearLeft = setupWithCans([can, left]);
    nearLeft.g.down(284, 300, 0); // 2 px from the left can and 4 px from the other
    nearLeft.g.up(50);
    expect(nearLeft.log).toEqual(["hit:8"]);
    const nearRight = setupWithCans([can, left]);
    nearRight.g.down(286, 300, 0);
    nearRight.g.up(50);
    expect(nearRight.log).toEqual(["hit:7"]);
  });

  it("does nothing different for balls when there are no cans", () => {
    const { g, log } = setup();
    g.down(100, 125, 0);
    g.up(90);
    expect(log).toEqual(["hit:1"]);
  });
});
