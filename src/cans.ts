// The cans of balls: how big they are, when one pours, and where they stand when they come out of the bag. Pure rules, in
// meters with y up, so that the court (physics.ts), the page (main.ts) and the tests can all use the same ones.

import type { Point } from "./geometry";

/** A can is 7.8 cm across and 22.4 cm tall: room for a column of three 6.7 cm balls. */
export const CAN_WIDTH = 0.078;
export const CAN_HEIGHT = 0.224;
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

/** The air a can keeps under the name. */
const NAME_AIR = 0.02;

/**
 * Where the three cans stand once they are out: on the floor (`floor` m above the bottom of the window) in a row, just left of the bag,
 * the first nearest to it. Each spot is the middle of the can's body. They stand 10 cm apart, a little wider than a ball, so that one
 * that is lifted out of the row and swings does not brush the next. `ink` are points along the name's outlines: where a letter hangs
 * so low over a spot that the can would run into it, as the tail of the "q" does in a short window, the can stands further left, where it clears.
 */
export function canSpots(bagLeft: number, floor = 0, ink: Point[] = []): Point[] {
  const pitch = CAN_WIDTH + 0.1;
  const top = floor + CAN_HEIGHT;
  const clear = (x: number) => ink.every((p) => p.x < x - CAN_WIDTH / 2 - NAME_AIR || p.x > x + CAN_WIDTH / 2 + NAME_AIR || p.y >= top + NAME_AIR);
  const spots: Point[] = [];
  for (let i = 0; i < CAN_COUNT; i++) {
    let x = i === 0 ? bagLeft - 0.13 : spots[i - 1].x - pitch;
    while (x > CAN_WIDTH && !clear(x)) x -= 0.01;
    spots.push({ x, y: floor + CAN_HEIGHT / 2 });
  }
  return spots;
}
