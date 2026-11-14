import { afterEach, describe, expect, it } from "vitest";
import { params } from "./params";
import { Court, STEP } from "./physics";

const RADIUS = params.ballDiameter / 2;
const defaults = { ...params };

afterEach(() => Object.assign(params, defaults));

/** Step the court for `seconds`, calling `watch` after every step. */
function run(court: Court, seconds: number, watch?: () => void): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    court.step();
    watch?.();
  }
}

/** Throw a ball: pick it up and let it go with the given velocity. */
function launch(court: Court, id: number, vx: number, vy: number): void {
  court.grab(id);
  court.release(vx, vy);
}

const atRest = (court: Court) => court.balls.every((b) => Math.hypot(b.vx, b.vy) < 0.001);

describe("Court", () => {
  it("bounces a dropped ball to regulation height", () => {
    // The rule: released with its underside 254 cm up, a ball must rebound 135 to 147 cm.
    const court = new Court(4, 4);
    const ball = court.addBall(2, 2.54 + RADIUS, false);
    let landed = false;
    let rebound = 0;
    run(court, 3, () => {
      if (ball.vy > 0) landed = true;
      if (landed && rebound === 0 && ball.vy <= 0) rebound = ball.y - RADIUS;
    });
    expect(rebound).toBeGreaterThan(1.35);
    expect(rebound).toBeLessThan(1.47);
  });

  it.each([0.5, 1, 1.5, 2, 2.54, 3])("comes to rest on the floor after a %s m drop", (height) => {
    const court = new Court(4, 6);
    const ball = court.addBall(2, height + RADIUS, false);
    run(court, 8);
    expect(atRest(court)).toBe(true);
    expect(ball.y - RADIUS).toBeLessThan(0.002);
  });

  it("comes to rest from every one of 200 drop heights", () => {
    // Guards the dead-bounce speed in physics.ts: set it too low and a few drops hop forever.
    const stillHopping: number[] = [];
    for (let i = 0; i < 200; i++) {
      const height = 0.05 + i * 0.0147;
      const court = new Court(4, 6);
      court.addBall(2, height + RADIUS, false);
      run(court, 7);
      if (!atRest(court)) stillHopping.push(height);
    }
    expect(stillHopping).toEqual([]);
  });

  it("stops a rolling ball in a few seconds", () => {
    const court = new Court(8, 4);
    const ball = court.addBall(0.5, RADIUS, false);
    launch(court, ball.id, 2, 0);
    run(court, 4);
    expect(atRest(court)).toBe(true);
    expect(ball.x).toBeGreaterThan(1);
    expect(ball.x).toBeLessThan(3.5);
  });

  it("lets a pile of balls settle", () => {
    const court = new Court(4, 4);
    court.addBall(0.05, 0.3, false);
    court.addBall(0.07, 0.6, false);
    court.addBall(0.04, 0.9, false);
    run(court, 8);
    expect(atRest(court)).toBe(true);
  });

  it("keeps a pinned ball in place until it is hit", () => {
    const court = new Court(4, 4);
    const ball = court.addBall(2, 2, true);
    run(court, 1);
    expect(ball.y).toBeCloseTo(2);
    court.hit(ball.id, 0, 1);
    run(court, 0.1);
    expect(ball.pinned).toBe(false);
    expect(ball.y).toBeGreaterThan(2.2);
  });

  it("sends a hit ball along the given direction at tap speed", () => {
    const court = new Court(4, 4);
    const ball = court.addBall(2, 2, true);
    court.hit(ball.id, Math.SQRT1_2, Math.SQRT1_2);
    court.step();
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.vy).toBeGreaterThan(0);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(params.hitSpeed, 0);
  });

  it("keeps balls inside the floor and side walls", () => {
    const court = new Court(2, 2);
    const ball = court.addBall(1, 1, false);
    launch(court, ball.id, -12, -6);
    let lowest = Infinity;
    let leftmost = Infinity;
    run(court, 2, () => {
      lowest = Math.min(lowest, ball.y);
      leftmost = Math.min(leftmost, ball.x);
    });
    expect(court.balls).toHaveLength(1);
    expect(lowest).toBeGreaterThan(RADIUS - 0.005);
    expect(leftmost).toBeGreaterThan(RADIUS - 0.005);
  });

  it("carries a held ball to the pointer and throws it on release", () => {
    const court = new Court(4, 4);
    const ball = court.addBall(1, 1, true);
    court.grab(ball.id);
    court.carryTo(2, 2.5);
    run(court, 0.5);
    expect(ball.x).toBeCloseTo(2, 1);
    expect(ball.y).toBeCloseTo(2.5, 1);
    court.release(3, 0);
    court.step();
    expect(ball.held).toBe(false);
    expect(ball.vx).toBeCloseTo(3, 0);
  });

  it("lets a ball leave through the top and fall back in", () => {
    const court = new Court(2, 2);
    const ball = court.addBall(1, 1, false);
    launch(court, ball.id, 0, 9);
    let highest = 0;
    run(court, 3, () => (highest = Math.max(highest, ball.y)));
    expect(highest).toBeGreaterThan(2);
    expect(court.balls).toHaveLength(1);
    expect(ball.y).toBeLessThan(2);
  });

  it("removes a ball that drifts past the side lines above the top", () => {
    const court = new Court(2, 2);
    const ball = court.addBall(1.8, 1.9, false);
    launch(court, ball.id, 3, 6);
    const gone: number[] = [];
    for (let i = 0; i < 360; i++) gone.push(...court.step());
    expect(gone).toEqual([ball.id]);
    expect(court.balls).toHaveLength(0);
  });

  it("bounces a ball off a peg", () => {
    // A solid disc near the bottom right corner, like the contact button.
    const peg = { x: 3.8, y: 0.2, radius: 0.055 };
    const court = new Court(4, 4, [], [peg]);
    const ball = court.addBall(3, 0.2, false);
    launch(court, ball.id, 8, 0);
    let closest = Infinity;
    let turnedBack = false;
    run(court, 0.4, () => {
      closest = Math.min(closest, Math.hypot(ball.x - peg.x, ball.y - peg.y));
      if (ball.vx < -1) turnedBack = true;
    });
    expect(closest).toBeGreaterThan(peg.radius + RADIUS - 0.005);
    expect(turnedBack).toBe(true);
  });

  it("knocks a pinned ball loose when another ball strikes it", () => {
    const court = new Court(4, 4);
    const dot = court.addBall(2, 2, true);
    const other = court.addBall(1.8, 2, false); // close enough that gravity cannot pull it under the dot first
    launch(court, other.id, 6, 0);
    run(court, 0.5);
    expect(dot.pinned).toBe(false);
    expect(dot.x).toBeGreaterThan(2.05);
  });
});
