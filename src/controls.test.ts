import { afterEach, describe, expect, it } from "vitest";
import { floorLiftFor, iconSizeFor } from "./controls";
import { params } from "./params";

const defaults = { ...params };
afterEach(() => Object.assign(params, defaults));

// The corner buttons' icons are as big as params.iconSize on a roomy window, and on a short one a share of its shorter side
// (params.iconShare), so that a phone held sideways, where the window is only about 280 px tall, is not crammed with them.
describe("how big the icons are in a window", () => {
  it.each([
    ["a laptop window", 1440, 800, 36],
    ["a phone held sideways, as iOS 26's Safari leaves it (two rows of toolbar)", 750, 280, 28],
    ["a phone held sideways with the older Safari", 750, 342, 34],
    ["a larger phone held sideways", 863, 360, 36],
    ["an iPhone SE held sideways", 568, 320, 32],
    ["a phone held upright (the shorter side is its width)", 390, 664, 36],
  ])("on %s (%i by %i) is %i px", (_name, width, height, expected) => {
    expect(iconSizeFor(width, height)).toBe(expected);
  });

  it("is the same whichever way the window is turned: it follows the shorter side", () => {
    expect(iconSizeFor(280, 750)).toBe(iconSizeFor(750, 280));
  });

  it("never gets smaller than 20 px, however short the window", () => {
    expect(iconSizeFor(600, 120)).toBe(20);
  });

  it("never gets bigger than params.iconSize, so a tuned size is a ceiling and not a fixed size", () => {
    params.iconSize = 24;
    expect(iconSizeFor(1440, 800)).toBe(24);
    expect(iconSizeFor(750, 280)).toBe(24); // 28 would have been the share's
    params.iconSize = 12; // the tuner goes lower than the floor of 20, and the ceiling wins there
    expect(iconSizeFor(1440, 800)).toBe(12);
  });

  it("follows params.iconShare, so that the tuner can move it", () => {
    params.iconShare = 0.08;
    expect(iconSizeFor(750, 280)).toBe(22);
    params.iconShare = 0.2;
    expect(iconSizeFor(750, 280)).toBe(36); // the ceiling again
  });

  it("is a whole number of pixels, which is what keeps the icons' lines crisp", () => {
    for (const height of [281, 297, 313, 327, 331, 349]) expect(Number.isInteger(iconSizeFor(900, height))).toBe(true);
  });
});

// A phone's floor can be lifted off the bottom edge of the screen, which is the system's own swipe-up zone, so that a ball lying on
// it can be picked up. A laptop has no such zone, and keeps its floor where it is.
describe("how far the floor is lifted", () => {
  it("is params.floorLiftPx on a touch screen, and nothing on any other", () => {
    params.floorLiftPx = 30;
    expect(floorLiftFor(true)).toBe(30);
    expect(floorLiftFor(false)).toBe(0);
    params.floorLiftPx = 0;
    expect(floorLiftFor(true)).toBe(0);
  });
});
