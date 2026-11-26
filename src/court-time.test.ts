import { describe, expect, it } from "vitest";
import { courtTime } from "./v6/scoreboard";

// QWW-111: the stats' time on court says which part is minutes and which is seconds: minutes, "m", seconds as two digits, "s".
describe("time on court", () => {
  it("reads 0m14s, 1m05s, 10m00s and 12m30s", () => {
    expect(courtTime(14_000)).toBe("0m14s");
    expect(courtTime(65_000)).toBe("1m05s");
    expect(courtTime(600_000)).toBe("10m00s");
    expect(courtTime(750_000)).toBe("12m30s");
  });

  it("rounds to the nearest second, and never shows 60 seconds", () => {
    expect(courtTime(0)).toBe("0m00s");
    expect(courtTime(59_600)).toBe("1m00s");
    expect(courtTime(14_400)).toBe("0m14s");
  });
});
