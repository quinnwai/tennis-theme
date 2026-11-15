// The courtside bench: a plank seat on two legs, like the bare ones in the reference photos, drawn flat. Real size, so it is
// longer than the window has room for and runs off the right edge; only its left end shows (params.benchReach). Everything here is
// in meters, y up, which is how the court wants its solid shapes.

import { boxOutline, type Point, type Rect } from "./geometry";
import { params } from "./params";

/** A bench is about 1.6 m long. */
const LENGTH = 1.6;
/** The seat is a plank this thick. */
const THICKNESS = 0.055;
/** Each leg stands this far in from its end of the seat. */
const LEG_INSET = 0.1;
/** A leg is this wide under the seat, and wider where it meets the floor, as the cast legs in the photos splay. */
const LEG_TOP = 0.06;
const LEG_FOOT = 0.1;
/** The air a leg keeps from a corner button. */
const KEEP_CLEAR = 0.02;

export interface BenchLayout {
  /** The seat's left end, and its right end, which is past the window's edge. */
  left: number;
  right: number;
  /** The top of the seat, and its underside. */
  seatTop: number;
  seatBottom: number;
  /** The seat, as a convex outline. */
  seat: Point[];
  /** The legs, each a convex outline from the floor to the seat. */
  legs: Point[][];
}

/**
 * The bench for a window `width` m wide, standing on a floor `floor` m above the bottom of the window. `avoid` are the corner buttons, as
 * boxes: the "?" sits in the bottom right corner, which is under the seat, so a leg that would stand on it stands a little to the left instead.
 */
export function layoutBench(width: number, avoid: Rect[] = [], floor = 0): BenchLayout {
  const left = width - params.benchReach;
  const right = left + LENGTH;
  const seatTop = floor + params.benchSeatHeight;
  const seatBottom = seatTop - THICKNESS;

  const centres = [left + LEG_INSET, right - LEG_INSET].map((x) => {
    for (const box of avoid) {
      if (box.bottom >= seatBottom || box.top <= floor) continue; // a leg reaches from the floor to the seat
      if (x - LEG_FOOT / 2 < box.right && x + LEG_FOOT / 2 + KEEP_CLEAR > box.left) x = Math.min(x, box.left - KEEP_CLEAR - LEG_FOOT / 2);
    }
    return x;
  });
  const legs = centres.map((x) => [
    { x: x - LEG_TOP / 2, y: seatBottom },
    { x: x - LEG_FOOT / 2, y: floor },
    { x: x + LEG_FOOT / 2, y: floor },
    { x: x + LEG_TOP / 2, y: seatBottom },
  ]);

  return { left, right, seatTop, seatBottom, seat: boxOutline({ left, bottom: seatBottom, right, top: seatTop }), legs };
}
