/**
 * The trophy the cans game is won with: the gold cup on its black base with a plaque (`design/v7/assets/trophy7-base.svg`), after the
 * Norman Brookes Challenge Cup. Millimeters at real size; the anchor (0, 0) is the middle of the base's front bottom edge.
 */
import artUrl from "../design/v7/assets/trophy7-base.svg?url";
import type { Vec } from "./input";

export const TROPHY_URL = artUrl;

/** The rim's middle across (mm from the anchor), how far it opens either side, the whole trophy's height (mm), and the art's size and where the anchor sits in it. */
export const TROPHY = { rimX: 28.7, rim: 334.1, open: 105, h: 385 };
export const TROPHY_ART = { w: 336, h: 387, ox: 139, oy: 385 };

/**
 * The outline balls bounce off (mm, y up, from the anchor): the base at half its depth, then the bowl's sides straight down to it, so
 * there is no pocket beside the stem for a ball to wedge into. Its sides are dead, as the bench's ends are.
 */
export const TROPHY_HULL: [number, number][] = [
  [-78.3, 24.1],
  [135.7, 24.1],
  [135.7, 94.1],
  [140.7, 269.1],
  [144.7, 334.1],
  [-87.3, 334.1],
  [-83.3, 269.1],
  [-78.3, 94.1],
];

/** The box the trophy settles as once it has been touched (its base and cup; the handles hang over): its middle from the anchor, and half its width and height (mm). */
export const TROPHY_BOX = { cx: 28.7, cy: 179.1, hw: 107, hh: 155 };

/** The rim's opening as drawn, around (rimX, rim): an ellipse slanted by the camera (the art's skewX of -50 degrees), for hiding a ball as it drops in behind the cup's front lip. */
export const TROPHY_LIP = { rx: 105, ry: 23.6, shear: Math.tan((50 * Math.PI) / 180) };

/** How long it takes to come from above the top edge down to where it floats (ms), how far it bobs (px), and how long a bob takes (ms). */
export const DESCENT_MS = 1600;
export const BOB_PX = 5;
export const BOB_MS = 2600;

/**
 * Where the trophy floats in a window, and how big: at real size, centred above the name about 9% of the window's height over it, or, in a
 * window too short for that, up to a fifth smaller, so that it still fits between the top edge and the name. `k` is px per mm at real
 * size, `nameTop` the top of the name (px).
 */
export function trophyFit(k: number, nameTop: number, width: number, height: number): { scale: number; rest: Vec } {
  let scale = Math.min(1, (nameTop - 18) / (TROPHY.h * k));
  const want = Math.max(28, 0.09 * height);
  scale = Math.min(scale, Math.max(scale * 0.8, (nameTop - 12 - want) / (TROPHY.h * k)));
  const gap = Math.min(want, nameTop - 12 - TROPHY.h * k * scale);
  return { scale, rest: { x: width / 2, y: nameTop - Math.max(4, gap) } };
}

/** Keep the whole trophy (its foot at `p`, `k` px per mm as drawn) on the page. */
export function keepTrophyIn(p: Vec, k: number, width: number, height: number): Vec {
  return {
    x: Math.min(width - (TROPHY_ART.w - TROPHY_ART.ox) * k, Math.max(TROPHY_ART.ox * k, p.x)),
    y: Math.min(height, Math.max(TROPHY.h * k + 8, p.y)),
  };
}

/** Where the middle of the trophy's foot is `sinceMs` after it started to come down: coming down, then bobbing gently where it floats. */
export function trophyAnchor(rest: Vec, sinceMs: number, reducedMotion: boolean): Vec {
  if (reducedMotion) return rest;
  const p = Math.min(1, sinceMs / DESCENT_MS);
  const eased = 1 - (1 - p) ** 3;
  const start = -12;
  const bob = p < 1 ? 0 : BOB_PX * Math.sin(((sinceMs - DESCENT_MS) / BOB_MS) * 2 * Math.PI);
  return { x: rest.x, y: start + (rest.y - start) * eased + bob };
}

/** Where a glint lands on the rim, from the trophy's foot (page px) at `k` px per mm. */
export const glintAt = (foot: Vec, k: number): Vec => ({ x: foot.x + (TROPHY.rimX + 74) * k, y: foot.y - (TROPHY.rim - 46) * k });
