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

/** Send a resting ball off with the given velocity, as one clean hit. */
function launch(court: Court, id: number, vx: number, vy: number): void {
  const speed = Math.hypot(vx, vy);
  params.hitSpeed = speed;
  court.hit(id, vx / speed, vy / speed);
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

  it("carries a held ball to the pointer, never faster than the carry speed", () => {
    const court = new Court(4, 4);
    const ball = court.addBall(1, 1, true);
    court.grab(ball.id);
    court.carryTo(2, 2.5);
    let fastest = 0;
    run(court, 1, () => (fastest = Math.max(fastest, Math.hypot(ball.vx, ball.vy))));
    expect(ball.x).toBeCloseTo(2, 1);
    expect(ball.y).toBeCloseTo(2.5, 1);
    expect(fastest).toBeLessThan(params.carrySpeed + 0.01);
  });

  it("keeps a carried ball close behind a pointer that moves steadily, but not glued to it", () => {
    // A drag at 1 m/s. A carried ball trails by speed / followRate: 7 cm when that was 14 a second, 2.8 cm now.
    const court = new Court(8, 4);
    const ball = court.addBall(0.5, 2, true);
    court.grab(ball.id);
    let pointer = 0.5;
    let gap = 0;
    run(court, 1.5, () => {
      pointer += STEP;
      court.carryTo(pointer, 2);
      gap = pointer - ball.x;
    });
    expect(gap).toBeGreaterThan(0.015); // it still has some weight
    expect(gap).toBeLessThan(0.04); // but trails by well under the 7 cm it once did
    // And once the pointer stops, it has caught up within a tenth of a second.
    run(court, 0.1, () => (gap = pointer - ball.x));
    expect(gap).toBeLessThan(0.002);
  });

  it("lets go of a ball pressed into the floor, or into a wall, without throwing it", () => {
    // The pointer can be somewhere the ball cannot go. The ball chases it, pressing against the
    // surface, and must not bounce off it while in the hand: letting go there is not a throw.
    const cases = [
      // A ball that has been resting on the floor for a while, so it is already touching it when picked up...
      { name: "the floor", settle: 1, target: { x: 2, y: -0.06 }, rest: { x: 2, y: RADIUS }, away: (b: { x: number; y: number }) => b.y - RADIUS },
      // ...and one picked up in mid air that is pushed into a wall.
      { name: "the right wall", settle: 0, target: { x: 4.06, y: 2 }, rest: { x: 4 - RADIUS, y: 2 }, away: (b: { x: number; y: number }) => 4 - RADIUS - b.x },
    ];
    for (const { name, settle, target, rest, away } of cases) {
      const court = new Court(4, 4);
      const ball = court.addBall(rest.x, rest.y, false);
      run(court, settle);
      court.grab(ball.id);
      run(court, 1, () => court.carryTo(target.x, target.y));
      court.release();
      // How far it moves off the surface it was pressed against, over the next 0.4 s.
      let farthest = 0;
      run(court, 0.4, () => (farthest = Math.max(farthest, away(ball))));
      expect(farthest, name).toBeLessThan(0.01);
    }
  });

  it("throws a carried ball with the speed it had when let go", () => {
    const court = new Court(4, 4);
    const ball = court.addBall(1, 2.5, true);
    court.grab(ball.id);
    court.carryTo(3.5, 2.5); // sweep to the right
    run(court, 0.1);
    court.release();
    court.step();
    expect(ball.held).toBe(false);
    expect(ball.vx).toBeGreaterThan(2);
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThan(params.carrySpeed + 0.2);
    run(court, 0.3);
    expect(ball.vy).toBeLessThan(-1); // and gravity has it again
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
    for (let i = 0; i < 3 / STEP; i++) gone.push(...court.step());
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
