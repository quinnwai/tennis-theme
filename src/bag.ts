// The tennis bag: a long racket bag lying on the floor, with a zip along its top. Dragging the zip's pull along the zip opens it;
// then the notebook stands up out of it and the cans come out. Everything here is in meters, y up.

import { boxOutline, type Point, type Rect } from "./geometry";
import { params } from "./params";

/** The bag's corners are cut off this much, which rounds it and leaves its top flat for balls to roll on. */
export const BAG_CORNER = 0.07;
/** The zip runs along the top, this far in from each end of the bag, and this far below its top edge. */
const ZIP_INSET = 0.1;
const ZIP_DROP = 0.035;
/** A composition book is about 25 by 19 cm. */
const NOTEBOOK_WIDTH = 0.19;
const NOTEBOOK_HEIGHT = 0.25;
/** Where along the bag the notebook stands, as a share of the bag's length from its left end. */
const NOTEBOOK_AT = 0.62;
/**
 * The air the bag and the notebook keep under the name; the least the notebook stands out of the bag, however little room there is; how far it
 * stands out before the bag gives up any height for it; and the lowest the bag is made.
 */
const NAME_AIR = 0.02;
const MIN_RISE = 0.04;
const FAIR_RISE = 0.08;
const MIN_HEIGHT = 0.12;

/** The pull is as good as at the end of the zip, and the bag is open, from this far along (0 is the start and 1 the end). */
export const ZIP_OPEN = 0.97;

export interface BagLayout {
  left: number;
  right: number;
  /** The floor it stands on, and its top. */
  bottom: number;
  top: number;
  /** The bag as a convex outline: a box with its corners cut. */
  body: Point[];
  /** The zip: the line the pull travels along, from where it starts (the zip is shut) to where it ends (open). */
  zip: { x0: number; x1: number; y: number };
  /** The whole notebook, most of it inside the bag, and the part that stands out of the top, which is what shows and what is solid. */
  notebook: Rect;
  notebookShown: Rect;
}

/**
 * The bag, with its right end at `right` m, standing on a floor `floor` m above the bottom of the window. `nameBottom` is how high above the
 * bottom of the window the name's lowest ink is over the bag, if it is over it. In a short window, a phone held sideways, the name sits low
 * and the floor may be lifted, which leaves little room between. The bag is then lower than it is made to be (but never lower than 12 cm),
 * so that the notebook can stand 8 cm out of it, which is enough to be seen; and if there is not even that, the notebook stands out by
 * less (but never less than 4 cm), so as not to run into the name.
 */
export function layoutBag(right: number, nameBottom = Infinity, floor = 0): BagLayout {
  const left = right - params.bagLength;
  const height = Math.max(MIN_HEIGHT, Math.min(params.bagHeight, nameBottom - floor - NAME_AIR - FAIR_RISE));
  const top = floor + height;
  const rise = Math.max(MIN_RISE, Math.min(params.notebookRise, nameBottom - top - NAME_AIR));
  const body = [
    { x: left + BAG_CORNER, y: floor },
    { x: right - BAG_CORNER, y: floor },
    { x: right, y: floor + BAG_CORNER },
    { x: right, y: top - BAG_CORNER },
    { x: right - BAG_CORNER, y: top },
    { x: left + BAG_CORNER, y: top },
    { x: left, y: top - BAG_CORNER },
    { x: left, y: floor + BAG_CORNER },
  ];
  const centre = left + NOTEBOOK_AT * params.bagLength;
  const notebookTop = top + rise;
  const notebook = { left: centre - NOTEBOOK_WIDTH / 2, bottom: notebookTop - NOTEBOOK_HEIGHT, right: centre + NOTEBOOK_WIDTH / 2, top: notebookTop };
  return {
    left,
    right,
    bottom: floor,
    top,
    body,
    zip: { x0: left + ZIP_INSET, x1: right - ZIP_INSET, y: top - ZIP_DROP },
    notebook,
    notebookShown: { ...notebook, bottom: top },
  };
}

/** Where the pull is when it is `along` of the way (0 to 1) down the zip. */
export function pullAt(bag: BagLayout, along: number): Point {
  return { x: bag.zip.x0 + along * (bag.zip.x1 - bag.zip.x0), y: bag.zip.y };
}

/** How far along the zip an x position is, kept between 0 and 1. */
export function alongOf(bag: BagLayout, x: number): number {
  return Math.min(1, Math.max(0, (x - bag.zip.x0) / (bag.zip.x1 - bag.zip.x0)));
}

/** The notebook's solid shape, once it stands out of the bag: the part above the top. */
export function notebookSolid(bag: BagLayout): Point[] {
  return boxOutline(bag.notebookShown);
}
