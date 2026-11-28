import { describe, expect, it } from "vitest";
import { BOB_PX, DESCENT_MS, TROPHY, glintAt, keepTrophyIn, trophyAnchor, trophyFit } from "./trophy";

const k = 0.5; // px per mm at real size, a window in which a ball is a few px

describe("where the trophy floats", () => {
  it("is over the middle of the name, about 9% of the window's height above it", () => {
    const { scale, rest } = trophyFit(k, 500, 1280, 800);
    expect(rest.x).toBe(640);
    expect(500 - rest.y).toBeCloseTo(72, 5);
    expect(scale).toBeLessThanOrEqual(1);
  });

  it("shrinks by no more than a fifth on a short window, and still fits above the name", () => {
    const full = Math.min(1, (120 - 18) / (TROPHY.h * k));
    const { scale, rest } = trophyFit(k, 120, 750, 280);
    expect(scale).toBeGreaterThanOrEqual(full * 0.8 - 1e-9);
    expect(rest.y - TROPHY.h * k * scale).toBeGreaterThanOrEqual(12 - 1e-9);
  });

  it("is kept inside the window", () => {
    const p = keepTrophyIn({ x: -50, y: 9999 }, k, 800, 600);
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBe(600);
  });
});

describe("how the trophy moves", () => {
  const rest = { x: 400, y: 300 };
  it("comes down from above the top edge, then bobs about where it floats", () => {
    expect(trophyAnchor(rest, 0, false).y).toBeLessThan(0);
    expect(trophyAnchor(rest, DESCENT_MS, false).y).toBeCloseTo(300, 5);
    for (let ms = DESCENT_MS; ms < DESCENT_MS + 6000; ms += 100) expect(Math.abs(trophyAnchor(rest, ms, false).y - 300)).toBeLessThanOrEqual(BOB_PX + 1e-9);
  });

  it("just floats with reduced motion", () => {
    expect(trophyAnchor(rest, 0, true)).toEqual(rest);
    expect(trophyAnchor(rest, 4000, true)).toEqual(rest);
  });

  it("glints on its rim, above the foot", () => {
    const g = glintAt({ x: 100, y: 300 }, k);
    expect(g.x).toBeGreaterThan(100);
    expect(g.y).toBeLessThan(300 - TROPHY.h * k * 0.5);
  });
});
