import { params } from "./params";

/** The smallest the corner buttons' icons get, however short the window. */
const SMALLEST_ICON = 20;

/** How far a floor is lifted off the bottom of the window, in px. Only a touch screen lifts it (`floorLiftPx` in params.ts says why). */
export function floorLiftFor(touch: boolean): number {
  return touch ? params.floorLiftPx : 0;
}

/**
 * How big the corner buttons' icons are in a window of this size, in px. On a roomy window they are `params.iconSize`. On a short one,
 * such as a phone held sideways, they are `params.iconShare` of the window's shorter side if that is less, so that the buttons
 * do not crowd a window that is only about 280 px tall. A whole number of pixels, which keeps the icons' lines crisp.
 */
export function iconSizeFor(width: number, height: number): number {
  const share = Math.round(Math.min(width, height) * params.iconShare);
  return Math.min(params.iconSize, Math.max(SMALLEST_ICON, share));
}
