// Where the bench, the bag, the notebook and the cans stand, in every window the page is shown in: always on the floor and in the
// window's right-hand part, never on a corner button and never on the name. The same is checked on the real page in
// e2e/bench-bag.spec.ts; this is the part that needs no browser, so it can cover many more windows.

import { describe, expect, it } from "vitest";
import { alongOf, pullAt, ZIP_OPEN, layoutBag, notebookSolid } from "./bag";
import { CAN_HEIGHT, CAN_WIDTH, canSpots } from "./cans";
import { flightPoint, layoutFurniture, solidsOf, type Surroundings } from "./furniture";
import { boundsOf, densify, grown, overlaps, type Point, type Rect } from "./geometry";
import { params } from "./params";
import { layoutName } from "./wordmark";
import { WORDMARKS } from "./wordmark.data";

/**
 * Windows, width by height in CSS px: laptops and desktops, phones held sideways (as in phone.test.ts), and phones held upright. The
 * window is always 2.4 m wide, so a window wider than about 2.9 to 1 is under 0.85 m tall, and the name hangs lower there than the bag
 * is tall: none of those is in the table, and the furniture cannot keep clear of the name in one.
 */
const WINDOWS: [name: string, width: number, height: number][] = [
  ["a laptop", 1440, 800],
  ["a laptop, short", 1280, 600],
  ["a full HD screen", 1920, 1080],
  ["a small laptop", 1024, 600],
  ["a wide, short window", 1440, 560],
  ["a very wide window", 1600, 600],
  ["a tall, narrow window", 800, 1100],
  ["iPhone 13 held sideways", 750, 342],
  ["iPhone 13 held sideways in iOS 26's Safari", 750, 280],
  ["iPhone 14 Pro held sideways", 734, 343],
  ["iPhone 12 Mini held sideways", 712, 325],
  ["Pixel 7 held sideways", 863, 360],
  ["Pixel 5 held sideways", 802, 293],
  ["Galaxy S8 held sideways", 740, 360],
  ["iPhone SE held sideways", 568, 320],
  ["iPhone 8 held sideways", 667, 375],
  ["iPhone 13 held upright", 390, 664],
  ["Pixel 7 held upright", 412, 839],
];

/** The corner buttons are 44 px boxes, 12 px in from the window's edges and 4 px apart (see site.css). */
const BOX = 44;
const EDGE = 12;
const GAP = 4;

/** The corner buttons that are always on the page, as boxes in meters: the row of three at the top right, and the "?" at the bottom right. */
function cornerButtons(width: number, height: number, pxPerMeter: number): Rect[] {
  const box = (left: number, top: number, right: number, bottom: number): Rect => ({
    left: left / pxPerMeter,
    right: right / pxPerMeter,
    top: (height - top) / pxPerMeter,
    bottom: (height - bottom) / pxPerMeter,
  });
  return [
    box(width - EDGE - (3 * BOX + 2 * GAP), EDGE, width - EDGE, EDGE + BOX),
    box(width - EDGE - BOX, height - EDGE - BOX, width - EDGE, height - EDGE),
  ];
}

/** Whether the segment from a to b passes through the box. */
function segmentHits(a: Point, b: Point, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const [p, q, lo, hi] of [
    [a.x, b.x, r.left, r.right],
    [a.y, b.y, r.bottom, r.top],
  ] as const) {
    const d = q - p;
    if (Math.abs(d) < 1e-12) {
      if (p < lo || p > hi) return false;
    } else {
      const [s, e] = [(lo - p) / d, (hi - p) / d].sort((m, n) => m - n);
      t0 = Math.max(t0, s);
      t1 = Math.min(t1, e);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** Everything that stands in the window once the bag is open and the cans are out, as named boxes in meters. */
function everything(width: number, surroundings: Surroundings) {
  const furniture = layoutFurniture(width, surroundings);
  const named: [string, Rect][] = [
    ["the seat", boundsOf(furniture.bench.seat)],
    ...furniture.bench.legs.map((leg, i): [string, Rect] => [`leg ${i + 1}`, boundsOf(leg)]),
    ["the bag", boundsOf(furniture.bag.body)],
    ["the notebook", furniture.bag.notebookShown],
    ...furniture.spots.map((s, i): [string, Rect] => [
      `can ${i + 1}`,
      { left: s.x - CAN_WIDTH / 2, right: s.x + CAN_WIDTH / 2, bottom: s.y - CAN_HEIGHT / 2, top: s.y + CAN_HEIGHT / 2 },
    ]),
  ];
  return { furniture, named };
}

/** How far the floor is lifted off the window's bottom edge, in px: not at all, as on a laptop, and by 30, which a phone can do (`floorLiftPx`). */
const LIFTS = [0, 30];

describe.each(WINDOWS.flatMap(([name, width, height]) => LIFTS.map((lift): [string, number, number, number] => [name, width, height, lift])))("on %s (%i by %i), the floor %i px up", (_name, width, height, lift) => {
  const layout = layoutName(width, height, WORDMARKS.ubuntu, params.ballScale);
  const pxPerMeter = layout.ballPx / params.ballDiameter;
  const floor = lift / pxPerMeter;
  const widthM = width / pxPerMeter;
  const heightM = height / pxPerMeter;
  const buttons = cornerButtons(width, height, pxPerMeter);
  const toMeters = (p: Point): Point => ({ x: p.x / pxPerMeter, y: (height - p.y) / pxPerMeter });
  const ink = layout.letters.flatMap((l) => l.loops.map((loop) => densify(loop.map(toMeters), 0.01)).flat());
  const { furniture, named } = everything(widthM, { avoid: buttons, ink, floor });

  it("is a window 2.4 m wide, whatever its size in px: the furniture's real size is what is laid out", () => {
    expect(widthM).toBeCloseTo(2.4, 1);
  });

  it("puts the bench with its left end to the right of the name, and running off the window's right edge", () => {
    const nameRight = Math.max(...layout.letters.flatMap((l) => l.loops.flat()).map((p) => toMeters(p).x));
    expect(furniture.bench.left).toBeGreaterThan(nameRight);
    expect(furniture.bench.right).toBeGreaterThan(widthM); // cut off by the edge
    expect(furniture.bench.seatTop).toBeCloseTo(floor + params.benchSeatHeight, 5);
  });

  it("puts the bag on the floor, wholly inside the window, with the cans' spots to its left", () => {
    const bag = boundsOf(furniture.bag.body);
    expect(bag.bottom).toBeCloseTo(floor, 10);
    expect(bag.left).toBeGreaterThan(0);
    for (const leg of furniture.bench.legs) expect(boundsOf(leg).bottom).toBeCloseTo(floor, 10);
    for (const spot of furniture.spots) expect(spot.y - CAN_HEIGHT / 2).toBeCloseTo(floor, 10);
    expect(bag.right).toBeLessThan(furniture.bench.left);
    for (const spot of furniture.spots) expect(spot.x).toBeGreaterThan(CAN_WIDTH / 2);
  });

  it.each(named)("keeps %s clear of every corner button", (_part, box) => {
    for (const button of buttons) expect(overlaps(box, button)).toBe(false);
  });

  it.each(named)("keeps %s clear of the name and of both balls on it", (_part, box) => {
    const room = grown(box, 0.005);
    for (const letter of layout.letters) {
      for (const loop of letter.loops) {
        const outline = loop.map(toMeters);
        for (let i = 0; i < outline.length; i++) expect(segmentHits(outline[i], outline[(i + 1) % outline.length], room)).toBe(false);
      }
    }
    for (const dot of layout.dots.map(toMeters)) {
      const near = Math.hypot(Math.max(room.left - dot.x, 0, dot.x - room.right), Math.max(room.bottom - dot.y, 0, dot.y - room.top));
      expect(near).toBeGreaterThan(params.ballDiameter / 2);
    }
  });

  it("keeps each can clear of the name all the way out of the bag and onto its spot", () => {
    // A can that had to stand further left to clear a low letter (the tail of the "q" in a short window with a lifted floor) cannot get there
    // without passing under that letter: it goes behind it, drawn under the name, for a moment. For that one it is its start and its spot that are checked.
    const nominal = canSpots(furniture.bag.left, floor);
    for (let i = 0; i < furniture.spots.length; i++) {
      const dodged = Math.abs(furniture.spots[i].x - nominal[i].x) > 1e-9;
      for (let step = 0; step <= 20; step++) {
        if (dodged && step > 0 && step < 20) continue;
        const at = flightPoint(furniture, i, step / 20);
        const can = { left: at.x - CAN_WIDTH / 2, right: at.x + CAN_WIDTH / 2, bottom: at.y - CAN_HEIGHT / 2, top: at.y + CAN_HEIGHT / 2 };
        for (const letter of layout.letters) {
          for (const loop of letter.loops) {
            const outline = loop.map(toMeters);
            for (let k = 0; k < outline.length; k++) expect(segmentHits(outline[k], outline[(k + 1) % outline.length], can), `can ${i + 1} at ${step}/20`).toBe(false);
          }
        }
      }
    }
  });

  it("goes out of the bag in an arc that is never longer than 0.2 m high, and ends on the spot", () => {
    expect(furniture.arc).toBeGreaterThanOrEqual(0);
    expect(furniture.arc).toBeLessThanOrEqual(0.2);
    furniture.spots.forEach((spot, i) => {
      expect(flightPoint(furniture, i, 1).x).toBeCloseTo(spot.x, 10);
      expect(flightPoint(furniture, i, 1).y).toBeCloseTo(spot.y, 10);
      expect(flightPoint(furniture, i, 0).y + CAN_HEIGHT / 2).toBeCloseTo(furniture.bag.top, 10); // it starts inside the bag, its top at the bag's top
    });
  });

  it("stands everything inside the window, on the floor or on the bench's own height", () => {
    for (const [, box] of named) {
      expect(box.bottom).toBeGreaterThanOrEqual(floor - 1e-9);
      expect(box.top).toBeLessThan(heightM);
    }
  });

  it("keeps the corner buttons' own open links out of nothing that matters: the links stand above the \"?\", and the legs are not under them", () => {
    // The three links open upward from the "?". The legs of the bench stand on the floor beside it, never on it.
    const questionMark = buttons[1];
    for (const leg of furniture.bench.legs) expect(overlaps(boundsOf(leg), questionMark)).toBe(false);
  });
});

describe("the bench, the bag and the cans' spots on the window that every other check uses", () => {
  it("is in the window the default numbers describe: a 0.42 m bench end, a 0.45 m seat, a 0.78 m bag 0.3 m tall", () => {
    const { furniture } = everything(2.4, {});
    expect(2.4 - furniture.bench.left).toBeCloseTo(params.benchReach, 5);
    expect(furniture.bench.seatTop).toBeCloseTo(0.45, 5);
    const bag = boundsOf(furniture.bag.body);
    expect(bag.right - bag.left).toBeCloseTo(0.78, 5);
    expect(bag.top).toBeCloseTo(0.3, 5);
    expect(furniture.bench.left - bag.right).toBeCloseTo(params.bagGap, 5);
  });

  it("makes every outline something the engine accepts: convex, and at most 12 corners", () => {
    const { furniture } = everything(2.4, {});
    const outlines = [...solidsOf(furniture), notebookSolid(furniture.bag)];
    for (const outline of outlines) {
      expect(outline.length).toBeGreaterThanOrEqual(3);
      expect(outline.length).toBeLessThanOrEqual(12);
      // Convex: every turn along the outline goes the same way.
      const turns = outline.map((p, i) => {
        const q = outline[(i + 1) % outline.length];
        const r = outline[(i + 2) % outline.length];
        return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
      });
      expect(turns.every((t) => t >= -1e-9) || turns.every((t) => t <= 1e-9)).toBe(true);
    }
  });

  it("moves a bench leg left when it would stand on a corner button, and leaves it alone when it would not", () => {
    const unbothered = layoutFurniture(2.4).bench;
    const button: Rect = { left: unbothered.left + 0.02, right: unbothered.left + 0.3, bottom: 0.05, top: 0.3 }; // right under the left leg
    const moved = layoutFurniture(2.4, { avoid: [button] }).bench;
    expect(boundsOf(moved.legs[0]).right).toBeLessThan(button.left);
    expect(boundsOf(moved.legs[1])).toEqual(boundsOf(unbothered.legs[1])); // the other leg, far to the right, stays
    const elsewhere = layoutFurniture(2.4, { avoid: [{ left: 0, right: 0.1, bottom: 0, top: 0.1 }] }).bench;
    expect(boundsOf(elsewhere.legs[0])).toEqual(boundsOf(unbothered.legs[0]));
  });
});

describe("the bag where there is little room under the name", () => {
  it("is as made, with the notebook as far out as it is made to be, where there is room", () => {
    const bag = layoutBag(1.8, 1.0);
    expect(bag.top).toBeCloseTo(params.bagHeight, 10);
    expect(bag.notebookShown.top - bag.top).toBeCloseTo(params.notebookRise, 10);
  });

  it("is lower, so that the notebook can stand 8 cm out of it, where there is not much room", () => {
    const bag = layoutBag(1.8, 0.36); // the name's lowest ink is 36 cm up, which leaves 34 cm under it with its air
    expect(bag.top).toBeCloseTo(0.26, 10);
    expect(bag.notebookShown.top - bag.top).toBeCloseTo(0.08, 10);
    expect(bag.notebookShown.top).toBeLessThanOrEqual(0.36 - 0.02 + 1e-9);
  });

  it("is never lower than 12 cm, and the notebook then stands out by less, never less than 4 cm", () => {
    const bag = layoutBag(1.8, 0.2);
    expect(bag.top).toBeCloseTo(0.12, 10);
    expect(bag.notebookShown.top - bag.top).toBeCloseTo(0.06, 10);
    expect(layoutBag(1.8, 0.1).notebookShown.top - layoutBag(1.8, 0.1).top).toBeCloseTo(0.04, 10);
  });

  it("stands on a floor that is lifted, and the room under the name is counted from the window's bottom", () => {
    const bag = layoutBag(1.8, 0.5, 0.1);
    expect(bag.bottom).toBeCloseTo(0.1, 10);
    expect(bag.top).toBeCloseTo(0.1 + 0.3, 10); // 0.5 - 0.1 - 0.02 - 0.08 = 0.30: just room for the bag as made
    expect(bag.notebookShown.top - bag.top).toBeCloseTo(0.08, 10);
  });
});

describe("the zip", () => {
  const bag = layoutBag(1.8);

  it("runs along the bag's top, well inside its ends, and is long enough to drag", () => {
    expect(bag.zip.x0).toBeGreaterThan(bag.left);
    expect(bag.zip.x1).toBeLessThan(bag.right);
    expect(bag.zip.y).toBeLessThan(bag.top);
    expect(bag.zip.y).toBeGreaterThan(bag.top - 0.1);
    expect(bag.zip.x1 - bag.zip.x0).toBeGreaterThan(0.4);
  });

  it("puts the pull at the start of the zip when it is shut and at the far end when it is open", () => {
    expect(pullAt(bag, 0)).toEqual({ x: bag.zip.x0, y: bag.zip.y });
    expect(pullAt(bag, 1)).toEqual({ x: bag.zip.x1, y: bag.zip.y });
  });

  it("tells how far along an x position is, and never gives less than 0 or more than 1", () => {
    expect(alongOf(bag, bag.zip.x0 - 1)).toBe(0);
    expect(alongOf(bag, bag.zip.x1 + 1)).toBe(1);
    expect(alongOf(bag, (bag.zip.x0 + bag.zip.x1) / 2)).toBeCloseTo(0.5, 10);
    for (const along of [0, 0.25, 0.8, 1]) expect(alongOf(bag, pullAt(bag, along).x)).toBeCloseTo(along, 10);
  });

  it("counts the bag as open a little before the very end, and not from the middle", () => {
    expect(ZIP_OPEN).toBeGreaterThan(0.9);
    expect(ZIP_OPEN).toBeLessThan(1);
  });

  it("has the notebook standing on the bag's flat top, with the rest of it inside the bag", () => {
    const top = boundsOf(layoutBag(1.8).body);
    expect(bag.notebookShown.bottom).toBeCloseTo(bag.top, 10);
    expect(bag.notebookShown.top - bag.top).toBeCloseTo(params.notebookRise, 10);
    expect(bag.notebook.bottom).toBeLessThan(bag.top); // most of it is down inside
    expect(bag.notebookShown.left).toBeGreaterThan(top.left + 0.07); // not over a cut corner
    expect(bag.notebookShown.right).toBeLessThan(top.right - 0.07);
    expect(bag.notebookShown.right - bag.notebookShown.left).toBeGreaterThan(0.15); // a composition book is about 19 cm across
  });

  it("keeps the pull's whole track, and the notebook, clear of each other's way: the notebook stands over the zip, so the pull is gone by the time it shows", () => {
    // The notebook rises out of the bag only once the zip is open, so the pull and the notebook are never both in play at one spot.
    expect(bag.notebookShown.left).toBeGreaterThan(bag.zip.x0);
    expect(bag.notebookShown.right).toBeLessThan(bag.zip.x1);
  });
});
