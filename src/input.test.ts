import { describe, expect, it } from "vitest";
import { Gestures, hitDirection, type GestureActions, type Vec } from "./input";
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
