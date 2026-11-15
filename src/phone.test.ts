// What a phone asks of the page that needs no browser to check: the name fits the windows that phones held sideways have,
// and the stylesheet says the things that the phone checks in a browser (e2e/phone.spec.ts) cannot see, because Chromium
// does not know them.

import { beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import { params } from "./params";
import { FIELDS } from "./tune";
import { layoutName } from "./wordmark";
import { WORDMARKS } from "./wordmark.data";

/**
 * The windows that phones held sideways give a page, as the phones' own browsers leave them (the bars already taken off):
 * the sizes Playwright lists for these phones. Width by height, in CSS px.
 */
const WINDOWS: [phone: string, width: number, height: number][] = [
  ["iPhone 13 and 12", 750, 342],
  ["iPhone 14 Pro and 15", 734, 343],
  ["iPhone 12 Mini", 712, 325],
  ["Pixel 7", 863, 360],
  ["Pixel 5", 802, 293],
  ["Galaxy S8", 740, 360],
  ["iPhone SE", 568, 320],
  ["iPhone 8", 667, 375],
];

/** The space the corner buttons take, as the stylesheet lays them out: 44 px boxes, 12 px from the edges, 4 px apart. */
const BOX = 44;
const EDGE = 12;
const GAP = 4;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Every corner button can be on screen at once: the row of three at the top right, and the "?" with its three links stacked above it. */
function cornerControls(width: number, height: number): Record<string, Rect> {
  return {
    "the row of buttons at the top right": { left: width - EDGE - (3 * BOX + 2 * GAP), top: EDGE, right: width - EDGE, bottom: EDGE + BOX },
    "the ? and its links at the bottom right": { left: width - EDGE - BOX, top: height - EDGE - BOX - 3 * (BOX + GAP), right: width - EDGE, bottom: height - EDGE },
  };
}

/** How far a point is from a rectangle, 0 inside it. */
const distanceToRect = (x: number, y: number, r: Rect) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));

describe.each(WINDOWS)("the name on %s held sideways (%i by %i)", (_phone, width, height) => {
  const layout = layoutName(width, height, WORDMARKS.ubuntu, params.ballScale);
  const ink = layout.letters.flatMap((letter) => letter.loops.flat());
  const radius = layout.ballPx / 2;
  const all = [...ink, ...layout.dots.flatMap((d) => [{ x: d.x - radius, y: d.y - radius }, { x: d.x + radius, y: d.y + radius }])];
  const box = {
    left: Math.min(...all.map((p) => p.x)),
    right: Math.max(...all.map((p) => p.x)),
    top: Math.min(...all.map((p) => p.y)),
    bottom: Math.max(...all.map((p) => p.y)),
  };

  it("lies wholly on screen, with a margin all round, balls included", () => {
    const margin = 8;
    expect(box.left).toBeGreaterThanOrEqual(margin);
    expect(box.top).toBeGreaterThanOrEqual(margin);
    expect(width - box.right).toBeGreaterThanOrEqual(margin);
    expect(height - box.bottom).toBeGreaterThanOrEqual(margin);
  });

  it("is centred across the window", () => {
    // The letters' own side bearings make the ink a hair off the middle; anything near 3% of the width would be a layout that leans.
    expect(Math.abs(box.left - (width - box.right))).toBeLessThan(width * 0.03);
  });

  it.each(Object.entries(cornerControls(width, height)))("stays clear of %s", (_name, rect) => {
    const room = 8; // at least this much air between the name or a ball and a button
    for (const p of ink) expect(distanceToRect(p.x, p.y, rect)).toBeGreaterThanOrEqual(room);
    for (const d of layout.dots) expect(distanceToRect(d.x, d.y, rect) - radius).toBeGreaterThanOrEqual(room);
  });
});

describe("the finger reach numbers in the tuner", () => {
  it.each([
    ["touchMinHitReachPx", "finger tap reach (px)"],
    ["touchMinGrabReachPx", "finger grab reach (px)"],
  ] as const)("%s has a slider, whose range holds the number in params.ts", (key, label) => {
    const field = FIELDS.find(([k]) => k === key);
    expect(field, `a slider for ${key}`).toBeDefined();
    const [, shown, min, max, step] = field!;
    expect(shown).toBe(label);
    expect(params[key]).toBeGreaterThanOrEqual(min);
    expect(params[key]).toBeLessThanOrEqual(max);
    expect(step).toBeGreaterThan(0);
  });
});

// Chromium, which the browser checks run on, does not know -webkit-touch-callout (it is Safari's), and the page leaves
// the work of its own prefixed copy of user-select to Safari too. Whether they are in the stylesheet is the most a test can say;
// that they do the job on an iPhone is on Quinn-Wai's list of things to try. The stylesheet looked at is the one that is built
// and shipped, not the source: a build that tidied away a prefixed property would cost an iPhone its copy.
describe("what the shipped stylesheet says that Chromium cannot show", () => {
  let css = "";
  beforeAll(async () => {
    const result = (await build({ logLevel: "silent", build: { write: false } })) as unknown;
    const { output } = (Array.isArray(result) ? result[0] : result) as { output: { fileName: string; source?: string | Uint8Array }[] };
    css = String(output.find((file) => file.fileName.endsWith(".css"))!.source);
  });

  /** The declarations of the rule whose selector is exactly `selector`, in the built (minified) stylesheet. */
  const declarations = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|})${escaped}\\{([^}]*)}`).exec(css)?.[1] ?? "";
  };

  it("keeps iOS's long-press callout and text selection off the toy", () => {
    const canvas = declarations(".play canvas");
    expect(canvas).toMatch(/-webkit-touch-callout:\s*none/);
    expect(canvas).toMatch(/-webkit-user-select:\s*none/);
    expect(canvas).toMatch(/(?<!-webkit-)user-select:\s*none/);
  });

  it("keeps the page's gestures for the toy: no overscroll on the page, no touch panning or zooming on the body and the canvas", () => {
    expect(declarations("html,body")).toMatch(/overscroll-behavior:\s*none/);
    expect(declarations(".play")).toMatch(/touch-action:\s*none/);
    expect(declarations(".play canvas")).toMatch(/touch-action:\s*none/);
  });

  it("gives a touch screen's buttons a floor of 44 px, whatever size the icon is tuned to", () => {
    const coarse = /@media \(pointer:\s*coarse\)\s*{\s*:root\s*{([^}]*)}/.exec(css)?.[1] ?? "";
    expect(coarse).toMatch(/--chip:\s*max\(44px,\s*calc\(var\(--icon-size\)\s*\+\s*8px\)\)/);
  });

  it("lets a hover open the contact links only where there is a mouse to hover with, so a finger's leftover hover cannot hold them open", () => {
    expect(css).toMatch(/@media \(hover:\s*hover\)\s*{\s*\.contact:hover a\.chip/);
    expect(css).not.toMatch(/\.contact:hover a\.chip\s*,/); // not in a list with the rules that apply everywhere
  });
});
