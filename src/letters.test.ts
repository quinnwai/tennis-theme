import { afterEach, describe, expect, it } from "vitest";
import type { Vec } from "./input";
import { params } from "./params";
import { Court, STEP } from "./physics";
import { layoutName } from "./wordmark";
import { ADVANCE, X_HEIGHT } from "./wordmark.data";

const WIDTH = 1440;
const HEIGHT = 800;
const RADIUS = params.ballDiameter / 2;
const defaults = { ...params };

afterEach(() => Object.assign(params, defaults));

/** The name laid out in a 1440 by 800 window, as a court in meters. */
function nameCourt() {
  const layout = layoutName(WIDTH, HEIGHT);
  const pxPerMeter = layout.ballPx / params.ballDiameter;
  const toMeters = (p: Vec) => ({ x: p.x / pxPerMeter, y: (HEIGHT - p.y) / pxPerMeter });
  const letters = layout.outlines.map((loop) => loop.map(toMeters));
  const court = new Court(WIDTH / pxPerMeter, HEIGHT / pxPerMeter, letters);
  const em = layout.emPx / pxPerMeter;
  const origin = toMeters(layout.origin);
  /** A point given in ems from the left end of the baseline. */
  const at = (xEms: number, yEms: number) => ({ x: origin.x + xEms * em, y: origin.y + yEms * em });
  return { court, layout, letters, toMeters, at, em };
}

function inside(point: Vec, loop: Vec[]): boolean {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function run(court: Court, seconds: number, watch?: () => void): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    court.step();
    watch?.();
  }
}

describe("letters", () => {
  it("catches a ball dropped into the u", () => {
    const { court, at } = nameCourt();
    const mouth = at(1 * ADVANCE + 0.305, X_HEIGHT + 0.6); // above the middle of the u, the second letter
    const ball = court.addBall(mouth.x, mouth.y, false);
    run(court, 8);
    const floorOfU = at(1 * ADVANCE + 0.305, 0);
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThan(0.001);
    expect(Math.abs(ball.x - floorOfU.x)).toBeLessThan(0.05);
    expect(ball.y).toBeGreaterThan(floorOfU.y);
    expect(ball.y).toBeLessThan(at(0, X_HEIGHT).y);
  });

  it("lets a ball come to rest on top of the i", () => {
    const { court, at } = nameCourt();
    const stemTop = at(2 * ADVANCE + 0.324, X_HEIGHT); // the first i is the third letter
    const ball = court.addBall(stemTop.x, stemTop.y + 0.3, false);
    run(court, 8);
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThan(0.001);
    expect(ball.y - RADIUS).toBeCloseTo(stemTop.y, 2);
  });

  it("never lets a fast ball inside a letter", () => {
    const { court, letters, at } = nameCourt();
    const center = at(4.5 * ADVANCE, X_HEIGHT / 2);
    // A fixed scatter of shots from all around the name, aimed at points across it.
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let worst = "";
    for (let shot = 0; shot < 60 && !worst; shot++) {
      const angle = random() * Math.PI * 2;
      const from = { x: center.x + Math.cos(angle) * 1.2, y: Math.max(RADIUS * 2, center.y + Math.sin(angle) * 0.8) };
      const target = at(random() * 9 * ADVANCE, random() * X_HEIGHT);
      const distance = Math.hypot(target.x - from.x, target.y - from.y);
      const speed = shot % 2 ? params.maxFling : 24;
      params.maxFling = speed;
      const ball = court.addBall(from.x, from.y, false);
      court.grab(ball.id);
      court.release(((target.x - from.x) / distance) * speed, ((target.y - from.y) / distance) * speed);
      run(court, 1.5, () => {
        const live = court.balls.find((b) => b.id === ball.id);
        if (live && letters.some((loop) => inside(live, loop))) worst = `shot ${shot} at ${speed} m/s ended up inside a letter`;
      });
      // Clear the court for the next shot by flinging what is left out past a side line.
      for (const b of [...court.balls]) {
        court.grab(b.id);
        court.carryTo(-1, 10);
        run(court, 0.5);
        court.release(0, 0);
      }
      run(court, 0.2);
    }
    expect(worst).toBe("");
  });
});
