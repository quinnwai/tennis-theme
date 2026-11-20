// The cans of balls: how big they are, when one pours, and where they stand when they come out of the bag. Pure rules, in
// meters with y up, so that the court (physics.ts), the page (main.ts) and the tests can all use the same ones.

import type { Point } from "./geometry";

/** A can is 7.9 cm across and 24.9 cm tall with its lid: room for a column of three 6.7 cm balls. */
export const CAN_WIDTH = 0.079;
export const CAN_HEIGHT = 0.249;
/** How many balls a can holds, like a real can. */
export const CAN_BALLS = 3;
/** How many cans there are, all in the bag at the start. */
export const CAN_COUNT = 3;

/**
 * A can with balls in it is heavy at the bottom. Its weight sits this far below its middle, as a share of half its height, which is
 * what makes it stand up when it is hung from the point it was taken by, and fall over only when it is shaken hard.
 */
export const CAN_BOTTOM_HEAVY = 0.4;

/** The way a can's mouth points: straight up for an upright can (angle 0), and turning with it. The angle is counter-clockwise, y up. */
export function mouthDirection(angle: number): Point {
  return { x: -Math.sin(angle), y: Math.cos(angle) };
}

/** How far a can has turned from upright, in degrees from 0 to 180, whichever way it has turned. */
export function tiltOf(angle: number): number {
  return Math.abs((Math.atan2(Math.sin(angle), Math.cos(angle)) * 180) / Math.PI);
}

/** Whether a can is tipped far enough to pour: its mouth turned more than `pourAngle` degrees from straight up. */
export function isTipped(angle: number, pourAngle: number): boolean {
  return tiltOf(angle) > pourAngle;
}
