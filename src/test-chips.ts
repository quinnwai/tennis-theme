// Helpers for the unit tests of the trail and the poof, which both hand the renderer a list of chips.
// Not part of the page: nothing in the app imports this.

import { SHAPE_STRIDE } from "./trail";

/** One chip as drawn: where it is, its two half sizes, and which way its long side points. */
export interface Chip {
  x: number;
  y: number;
  halfLength: number;
  halfThickness: number;
  cx: number;
  cy: number;
}

/**
 * What a trail or a poof would draw at `now`, for balls `r` pixels in radius, in the order it lists
 * them. Ask for times in order: chips that have gone are forgotten.
 */
export function chipsOf(model: { shapes(now: number, r: number): number; out: Float32Array }, now: number, r: number): Chip[] {
  const n = model.shapes(now, r);
  const s = model.out;
  const list: Chip[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * SHAPE_STRIDE;
    list.push({ x: s[o], y: s[o + 1], halfLength: s[o + 2], halfThickness: s[o + 3], cx: s[o + 4], cy: s[o + 5] });
  }
  return list;
}

export const area = (c: Chip) => 4 * c.halfLength * c.halfThickness;

/** Whether a point lies inside a chip. */
export function covers(c: Chip, x: number, y: number): boolean {
  const dx = x - c.x;
  const dy = y - c.y;
  return Math.abs(dx * c.cx + dy * c.cy) <= c.halfLength && Math.abs(-dx * c.cy + dy * c.cx) <= c.halfThickness;
}
