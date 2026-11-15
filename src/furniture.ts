// Where the bench, the bag and the cans' spots are for a window of a given width, as one set. Meters, y up.

import { CAN_HEIGHT, CAN_WIDTH, canSpots } from "./cans";
import { layoutBag, type BagLayout } from "./bag";
import { layoutBench, type BenchLayout } from "./bench";
import type { Point, Rect } from "./geometry";
import { params } from "./params";

/** The most a can rises above the straight way out of the bag, and the air its top keeps under the name. */
const MAX_ARC = 0.2;
const NAME_AIR = 0.03;

export interface Furniture {
  bench: BenchLayout;
  bag: BagLayout;
  /** Where each can stands once it is out of the bag. */
  spots: Point[];
  /** How far above the straight way from the bag's top to its spot a can goes on its way out, at most: less where the name hangs low. */
  arc: number;
}

/** What the furniture has to keep clear of: the corner buttons, as boxes, and the name, as the points of its outlines. And what it stands on. */
export interface Surroundings {
  avoid?: Rect[];
  ink?: Point[];
  /** How far above the bottom of the window the floor is, in meters. */
  floor?: number;
}

/**
 * Lay out the furniture for a window `width` m wide: the bench off the right edge, the bag on the floor just left of it, and the
 * cans' spots left of that.
 */
export function layoutFurniture(width: number, { avoid = [], ink = [], floor = 0 }: Surroundings = {}): Furniture {
  const bench = layoutBench(width, avoid, floor);
  const right = bench.left - params.bagGap;
  const left = right - params.bagLength;
  // How low the name's ink hangs over the bag.
  const nameBottom = Math.min(Infinity, ...ink.filter((p) => p.x >= left && p.x <= right).map((p) => p.y));
  const bag = layoutBag(right, nameBottom, floor);
  const spots = canSpots(bag.left, floor, ink);
  // A can goes out over the cans' row and the left of the bag. As much arc as there is room for under the name, up to a limit: the top of
  // the can, all the way along its path, stays under it.
  const pathLeft = spots[spots.length - 1].x - CAN_WIDTH / 2;
  const pathBottom = Math.min(Infinity, ...ink.filter((p) => p.x >= pathLeft && p.x <= bag.left + 0.3).map((p) => p.y));
  const furniture: Furniture = { bench, bag, spots, arc: MAX_ARC };
  const highest = () => Math.max(...spots.flatMap((_, i) => Array.from({ length: 21 }, (__, k) => flightPoint(furniture, i, k / 20).y + CAN_HEIGHT / 2)));
  while (furniture.arc > 0 && highest() > pathBottom - NAME_AIR) furniture.arc = Math.max(0, furniture.arc - 0.01);
  return furniture;
}

/**
 * Where the middle of the can that is going to spot `i` is, `t` of the way (0 to 1) out of the bag and onto its spot: it sets off from
 * inside the bag, a little in from its left end, with its top at the bag's top, and rises and comes down on its spot in an arc.
 */
export function flightPoint(furniture: Furniture, i: number, t: number): Point {
  const from = { x: furniture.bag.left + 0.2, y: furniture.bag.top - CAN_HEIGHT / 2 };
  const spot = furniture.spots[i];
  return { x: from.x + (spot.x - from.x) * t, y: from.y + (spot.y - from.y) * t + furniture.arc * 4 * t * (1 - t) };
}

/** The shapes that always stand in the court: the seat, its legs and the bag. (The notebook's is added once it is out.) */
export function solidsOf(furniture: Furniture): Point[][] {
  return [furniture.bench.seat, ...furniture.bench.legs, furniture.bag.body];
}
