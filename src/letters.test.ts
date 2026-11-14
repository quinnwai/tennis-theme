import { afterEach, describe, expect, it } from "vitest";
import type { Vec } from "./input";
import { params } from "./params";
import { Court, STEP } from "./physics";
import { layoutName } from "./wordmark";
import { WORDMARKS } from "./wordmark.data";

const WIDTH = 1440;
const HEIGHT = 800;
const RADIUS = params.ballDiameter / 2;
const defaults = { ...params };

afterEach(() => Object.assign(params, defaults));

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

describe.each(Object.keys(WORDMARKS))("letters set in %s", (font) => {
  /** The name laid out in a 1440 by 800 window, as a court in meters. */
  function nameCourt() {
    const layout = layoutName(WIDTH, HEIGHT, WORDMARKS[font], params.ballScale);
    const pxPerMeter = layout.ballPx / params.ballDiameter;
    const toMeters = (p: Vec) => ({ x: p.x / pxPerMeter, y: (HEIGHT - p.y) / pxPerMeter });
    const letters = layout.letters.map((l) => ({ char: l.char, loops: l.loops.map((loop) => loop.map(toMeters)) }));
    const outlines = letters.flatMap((l) => l.loops);
    const court = new Court(WIDTH / pxPerMeter, HEIGHT / pxPerMeter, outlines);
    const box = (points: Vec[]) => ({
      left: Math.min(...points.map((p) => p.x)),
      right: Math.max(...points.map((p) => p.x)),
      bottom: Math.min(...points.map((p) => p.y)),
      top: Math.max(...points.map((p) => p.y)),
    });
    return { court, layout, letters, outlines, toMeters, box };
  }

  it("brings a ball dropped onto the u to rest, outside every letter", () => {
    const { court, letters, outlines, box } = nameCourt();
    const u = box(letters.find((l) => l.char === "u")!.loops.flat());
    const ball = court.addBall((u.left + u.right) / 2, u.top + 0.4, false);
    run(court, 10);
    // Where it ends up depends on the typeface: in the cup of the u when it fits, otherwise in a
    // notch between letters or on the floor. It must end up somewhere, and never inside a stroke.
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThan(0.001);
    expect(outlines.some((loop) => inside(ball, loop))).toBe(false);
  });

  it("lets a ball come to rest on top of the i", () => {
    const { court, layout, toMeters } = nameCourt();
    const stemTop = toMeters(layout.stemTops[0]);
    const ball = court.addBall(stemTop.x, stemTop.y + 0.3, false);
    run(court, 8);
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThan(0.001);
    expect(ball.y - RADIUS).toBeCloseTo(stemTop.y, 2);
  });

  it("never lets a fast ball inside a letter", () => {
    const { outlines, box } = nameCourt();
    const name = box(outlines.flat());
    const center = { x: (name.left + name.right) / 2, y: (name.bottom + name.top) / 2 };
    // A fixed scatter of shots from all around the name, aimed at points across it.
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const failures: string[] = [];
    for (let shot = 0; shot < 60; shot++) {
      const { court } = nameCourt();
      const angle = random() * Math.PI * 2;
      const from = { x: center.x + Math.cos(angle) * 1.2, y: Math.max(RADIUS * 2, center.y + Math.sin(angle) * 0.8) };
      const target = {
        x: name.left + random() * (name.right - name.left),
        y: name.bottom + random() * (name.top - name.bottom),
      };
      const distance = Math.hypot(target.x - from.x, target.y - from.y);
      params.hitSpeed = shot % 2 ? 10 : 24;
      const ball = court.addBall(from.x, from.y, false);
      court.hit(ball.id, (target.x - from.x) / distance, (target.y - from.y) / distance);
      run(court, 1.5, () => {
        const live = court.balls.find((b) => b.id === ball.id);
        if (live && outlines.some((loop) => inside(live, loop))) failures.push(`shot ${shot} at ${params.hitSpeed} m/s`);
      });
    }
    expect([...new Set(failures)]).toEqual([]);
  });
});
