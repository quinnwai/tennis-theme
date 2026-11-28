// QWW-103 (step 4 of QWW-99): winning the match and playing again, written before the change by chief-keef.
// What this asks of src/v6/match.ts beyond what it has: `point()` gives "won" on the point that wins the match (from 40-30), a `won`
// flag, and `playAgain()`, which starts a new match at 15-30 and keeps the game found. Nothing here may be weakened to pass.

import { describe, expect, it } from "vitest";
import { Match } from "./v6/match";

const board = (m: Match) => [m.call(m.you), m.call(m.them)];

describe("the match", () => {
  it("is won by the third point from 15-30: 30-30, 40-30 (championship point), then game, set and match", () => {
    const m = new Match();
    m.found = true;
    expect(board(m)).toEqual(["15", "30"]);
    expect(m.point()).toBe("point");
    expect(m.point()).toBe("championship point");
    expect(m.championshipPoint).toBe(true);
    expect(m.won).toBe(false);
    expect(m.point()).toBe("won");
    expect(m.won).toBe(true);
  });

  it("takes no more points once it is won", () => {
    const m = new Match();
    m.found = true;
    m.point();
    m.point();
    m.point();
    expect(m.point()).toBe("over");
    expect(m.won).toBe(true);
  });

  it("starts again at 15-30 with Play again, still found", () => {
    const m = new Match();
    m.found = true;
    m.point();
    m.point();
    m.point();
    m.playAgain();
    expect(m.won).toBe(false);
    expect(m.found).toBe(true);
    expect(board(m)).toEqual(["15", "30"]);
    expect(m.championshipPoint).toBe(false);
  });

  it("is hidden again by a reset (Restart), and not won", () => {
    const m = new Match();
    m.found = true;
    m.point();
    m.point();
    m.point();
    m.reset();
    expect(m.found).toBe(false);
    expect(m.won).toBe(false);
    expect(board(m)).toEqual(["15", "30"]);
  });
});
