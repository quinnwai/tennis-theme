import { describe, expect, it } from "vitest";
import { Gestures, hitDirection, pointerVelocity, type GestureActions, type Vec } from "./input";

const ball = { id: 1, x: 100, y: 100, r: 13 };

function setup() {
  const log: string[] = [];
  const last: { dir?: Vec; velocity?: Vec } = {};
  const actions: GestureActions = {
    hit: (id, dir) => {
      log.push(`hit:${id}`);
      last.dir = dir;
    },
    grab: (id) => log.push(`grab:${id}`),
    carry: (at) => log.push(`carry:${at.x},${at.y}`),
    release: (velocity) => {
      log.push("release");
      last.velocity = velocity;
    },
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

describe("pointerVelocity", () => {
  it("measures a steady drag", () => {
    const samples = [0, 20, 40, 60].map((t) => ({ x: t * 2, y: -t, t }));
    const v = pointerVelocity(samples, 65);
    expect(v.x).toBeCloseTo(2000);
    expect(v.y).toBeCloseTo(-1000);
  });

  it("is zero when the pointer paused before letting go", () => {
    const samples = [0, 20, 40].map((t) => ({ x: t * 2, y: 0, t }));
    expect(pointerVelocity(samples, 140)).toEqual({ x: 0, y: 0 });
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

  it("picks the ball up when pressed and dragged, then throws it on release", () => {
    const { g, log, last } = setup();
    g.down(102, 101, 0);
    g.move(120, 101, 20);
    g.move(140, 101, 40);
    g.move(160, 101, 60);
    g.up(62);
    expect(log).toEqual(["grab:1", "carry:120,101", "carry:140,101", "carry:160,101", "release"]);
    expect(last.velocity!.x).toBeCloseTo(((160 - 102) / 60) * 1000);
    expect(last.velocity!.y).toBeCloseTo(0);
  });

  it("picks the ball up when held still past the tap window", () => {
    const { g, log, last } = setup();
    g.down(100, 100, 0);
    g.tick(100);
    expect(log).toEqual([]);
    g.tick(300);
    expect(log).toEqual(["grab:1"]);
    g.up(900);
    expect(log).toEqual(["grab:1", "release"]);
    expect(last.velocity).toEqual({ x: 0, y: 0 });
  });

  it("does nothing for a drag that starts beside the ball rather than on it", () => {
    const { g, log } = setup();
    g.down(100, 128, 0);
    g.move(140, 128, 30);
    g.up(60);
    expect(log).toEqual([]);
  });

  it("does not hit when a press beside the ball is held too long", () => {
    const { g, log } = setup();
    g.down(100, 128, 0);
    g.up(400);
    expect(log).toEqual([]);
  });
});
