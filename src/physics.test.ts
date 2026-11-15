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

  it.each([0.03, 0.1])("rests on a floor lifted %s m off the bottom of the window, and a ball cannot sink below it", (lift) => {
    // On a phone the bottom edge of the screen is the system's own swipe-up zone; the toy keeps its balls out of it by lifting the floor.
    const court = new Court(4, 6, [], [], lift);
    const dropped = court.addBall(1, 2, false);
    const held = court.addBall(3, 2, false); // pressed down by a finger into the floor, which it must not go through
    run(court, 8);
    expect(atRest(court)).toBe(true);
    expect(dropped.y - RADIUS).toBeCloseTo(lift, 2);
    court.grab(held.id);
    court.carryTo(3, -1); // a pointer somewhere under the floor
    run(court, 1);
    expect(held.y - RADIUS).toBeGreaterThan(lift - 0.002);
  });

  it("has its floor at the bottom of the window unless it is told to lift it", () => {
    const court = new Court(4, 6);
    const ball = court.addBall(2, 1, false);
    run(court, 8);
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

describe("Court impacts", () => {
  /** Every impact the court reports over `seconds`, with the moment of the step that reported it. */
  function collect(court: Court, seconds: number): { at: number; speed: number }[] {
    const log: { at: number; speed: number }[] = [];
    let steps = 0;
    run(court, seconds, () => {
      steps++;
      for (const impact of court.impacts) log.push({ at: steps * STEP, speed: impact.speed });
    });
    return log;
  }

  it("reports how fast a dropped ball hits the floor", () => {
    const court = new Court(4, 4);
    court.addBall(2, 1 + RADIUS, false);
    const [first] = collect(court, 1);
    const falling = Math.sqrt(2 * params.gravity * 1); // 4.43 m/s; air drag takes a little off
    expect(first.speed).toBeGreaterThan(falling * 0.97);
    expect(first.speed).toBeLessThan(falling);
  });

  it("reports each bounce of a dropped ball, each gentler than the last, until it comes to rest", () => {
    const court = new Court(4, 4);
    court.addBall(2, 1 + RADIUS, false);
    const log = collect(court, 6);
    expect(log.length).toBeGreaterThan(8);
    log.slice(1).forEach((impact, i) => {
      expect(impact.speed).toBeLessThan(log[i].speed);
      // Each bounce keeps about the share of the speed that the ball's bounciness says. Below 1 m/s a step of
      // gravity is a big part of the speed, and the share creeps up.
      if (impact.speed > 1) expect(impact.speed / log[i].speed).toBeCloseTo(params.restitution, 1);
    });
    expect(collect(court, 2)).toEqual([]); // and a ball at rest strikes nothing
  });

  it("reports nothing for a ball rolling along the floor", () => {
    const court = new Court(8, 4);
    const ball = court.addBall(0.5, RADIUS, false);
    launch(court, ball.id, 2, 0);
    expect(collect(court, 4)).toEqual([]);
  });

  it("reports a ball striking another ball once, at the speed they closed", () => {
    const court = new Court(8, 4);
    const mover = court.addBall(1, 2, false);
    court.addBall(2, 2, false);
    court.balls[1].y = 2; // both float level with each other, a long way up
    launch(court, mover.id, 3, 0);
    // Gravity pulls both down at the same rate, so what matters is how fast they close along the x axis.
    let closing = 0;
    let strikes = 0;
    for (let i = 0; i < 2 / STEP && strikes === 0; i++) {
      closing = mover.vx;
      court.step();
      strikes = court.impacts.length;
      if (strikes > 0) expect(court.impacts).toHaveLength(1); // one impact for the pair, not one for each ball
    }
    expect(strikes).toBe(1);
    expect(court.impacts[0].speed).toBeGreaterThan(closing * 0.9);
    expect(court.impacts[0].speed).toBeLessThan(closing * 1.1);
  });

  it("reports a ball striking a peg head on at the speed it flew", () => {
    params.gravity = 0; // so that the ball flies level and meets the peg's middle, not a spot below it
    const peg = { x: 3.8, y: 0.2, radius: 0.055 };
    const court = new Court(4, 4, [], [peg]);
    const ball = court.addBall(3, 0.2, false);
    launch(court, ball.id, 8, 0);
    let flying = 0;
    let reported = 0;
    for (let i = 0; i < 0.3 / STEP && reported === 0; i++) {
      flying = ball.vx;
      court.step();
      reported = court.impacts[0]?.speed ?? 0;
    }
    expect(flying).toBeGreaterThan(7.5);
    expect(reported).toBeGreaterThan(flying * 0.98);
    expect(reported).toBeLessThan(flying * 1.02);
  });

  it("counts a ball that meets two walls in the very same step once", () => {
    params.gravity = 0; // so that it runs along the diagonal and reaches both walls in the same step
    const court = new Court(4, 4);
    const ball = court.addBall(0.3, 0.3, false);
    launch(court, ball.id, -3, -3); // straight into the bottom left corner
    expect(collect(court, 0.15)).toHaveLength(1);
  });

  it.each([
    ["the wall harder than the floor", { vx: -3, vy: -2.2 }],
    ["the floor harder than the wall", { vx: -2.2, vy: -3 }],
  ])("counts a ball that meets two walls in the very same step once, at the speed of the harder: %s", (_, shot) => {
    params.gravity = 0;
    const court = new Court(4, 4);
    // Set down overlapping both the wall and the floor, so that both contacts begin in the first step.
    const ball = court.addBall(RADIUS - 0.001, RADIUS - 0.001, false);
    launch(court, ball.id, shot.vx, shot.vy);
    court.step();
    expect(court.impacts).toHaveLength(1);
    expect(court.impacts[0].speed).toBeGreaterThan(2.9);
  });

  it("counts a hard impact that follows a soft one within the quiet period, at its own speed", () => {
    params.gravity = 0;
    // The ball grazes the floor at 0.6 m/s and meets the wall at about 5 m/s two steps (8 ms) later: a letter's
    // corner does this. The knock must not be swallowed by the graze that came just before it.
    const court = new Court(4, 4);
    const ball = court.addBall(0.6815, 0.0935, false);
    launch(court, ball.id, -6, -0.6);
    const log = collect(court, 0.3);
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log[0].speed).toBeLessThan(1); // the graze, which came first
    expect(log[1].at - log[0].at).toBeLessThan(0.03); // and the knock came soon enough to have been swallowed
    expect(log[1].speed).toBeGreaterThan(5);
  });

  it("counts a push into a wall once, however much harder it gets: a ball in the hand does not bounce", () => {
    // A carried ball is not bouncy (see Court.grab), so pressing it into a wall is one meeting, and pushing harder
    // afterwards makes no new one: there is no bounce for it to come back from. (That a much harder meeting inside
    // the quiet spell counts again is shown with a free ball, in the test above about a graze and a knock.)
    params.gravity = 0;
    params.followRate = 14; // a gentle chase, so that the three pushes below are three different speeds; the default
    // chase reaches the speed limit on the first one
    const court = new Court(4, 4);
    const ball = court.addBall(3.9, 1, true);
    court.grab(ball.id);
    court.carryTo(4.1, 1); // the pointer is beyond the wall, so the ball is pushed into it at about 1.9 m/s
    expect(collect(court, 0.3)).toHaveLength(1);
    court.carryTo(4.16, 1); // a harder push
    expect(collect(court, 0.3)).toHaveLength(0);
    court.carryTo(4.5, 1); // a much harder one: the fastest a ball is carried
    expect(collect(court, 0.3)).toHaveLength(0);
  });

  it("counts a ball that meets a wall and then the floor a moment later once", () => {
    const court = new Court(4, 4);
    const ball = court.addBall(0.3, 0.3, false);
    launch(court, ball.id, -3, -3); // gravity has it reach the floor first, and the wall within a few steps
    expect(collect(court, 0.15)).toHaveLength(1);
  });

  it("counts a ball striking one that is resting, even if the striker has only just bounced off the floor", () => {
    // A ball lands just short of a resting one. For a landing spot in a narrow band it touches the floor and then,
    // within a few milliseconds, the resting ball, and both are impacts: the resting ball has been free of
    // contacts, and the striker has not. Which spot does that depends on the numbers, so scan for one.
    params.hitSpeed = 0.8;
    const spots: number[] = [];
    for (let offset = 0.2; offset <= 0.34; offset += 0.002) {
      const court = new Court(4, 4);
      court.addBall(2, RADIUS, false);
      run(court, 1); // the resting ball settles
      const striker = court.addBall(2 - offset, 0.3 + RADIUS, false);
      court.hit(striker.id, 1, 0);
      const log = collect(court, 0.5);
      if (log.some((impact, i) => i > 0 && impact.at - log[i - 1].at < 0.03)) spots.push(offset);
    }
    expect(spots.length).toBeGreaterThan(0);
  });

  it("counts a carried ball held against a wall once, not at every step it is pushed into it", () => {
    const court = new Court(4, 4);
    const ball = court.addBall(1, 1, true);
    court.grab(ball.id);
    court.carryTo(6, 1); // the pointer is on the far side of the right wall
    const log = collect(court, 2);
    expect(log).toHaveLength(1);
    expect(log[0].speed).toBeCloseTo(params.carrySpeed, 0);
  });

  it("clears the report at the start of every step", () => {
    const court = new Court(4, 4);
    court.addBall(2, 1 + RADIUS, false);
    let reported = false;
    while (!reported) {
      court.step();
      reported = court.impacts.length > 0;
    }
    court.step();
    expect(court.impacts).toEqual([]);
  });
});
