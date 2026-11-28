// The cans of balls: how big they are, and how many. Pure rules, in
// meters with y up, so that the court (physics.ts), the page (main.ts) and the tests can all use the same ones.

import type { Point } from "./geometry";

/** A can is 7.9 cm across and 24.9 cm tall with its lid: room for a column of three 6.7 cm balls. */
export const CAN_WIDTH = 0.079;
export const CAN_HEIGHT = 0.249;
/** How many balls a can holds, like a real can. */
export const CAN_BALLS = 3;
/** How many cans there are, all in the bag at the start. */
export const CAN_COUNT = 3;
