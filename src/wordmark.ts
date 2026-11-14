import type { Vec } from "./input";
import { ADVANCE, DOT, GLYPHS, X_HEIGHT } from "./wordmark.data";

const NAME = "quinn wai";

/** Share of the window's width the name fills, and the most of its height the name may take. */
const WIDTH_SHARE = 0.62;
const HEIGHT_SHARE = 0.42;
/** Ems from the bottom of the "q" to the top of a dot. */
const FULL_HEIGHT = 0.94;

/** How the name sits in the window. Screen space: CSS pixels, y down. */
export interface NameLayout {
  /** Pixels per em. */
  emPx: number;
  /** Left end of the baseline, the point every letter is measured from. */
  origin: Vec;
  /** Every letter outline as a closed loop of points. The i's come without their dots. */
  outlines: Vec[][];
  /** Centers of the dots of the two i's. */
  dots: Vec[];
  /** Top of each i's stem, directly under its dot. */
  stemTops: Vec[];
  /** Diameter of a dot, and so of every ball. */
  ballPx: number;
}

/** Center the name in a window of the given size, as large as the width and height shares allow. */
export function layoutName(width: number, height: number): NameLayout {
  const nameEms = NAME.length * ADVANCE;
  const emPx = Math.min((width * WIDTH_SHARE) / nameEms, (height * HEIGHT_SHARE) / FULL_HEIGHT);
  const origin = {
    x: (width - nameEms * emPx) / 2,
    y: height / 2 + (X_HEIGHT * emPx) / 2,
  };

  const outlines: Vec[][] = [];
  const dots: Vec[] = [];
  const stemTops: Vec[] = [];
  [...NAME].forEach((char, index) => {
    const left = origin.x + index * ADVANCE * emPx;
    for (const loop of GLYPHS[char] ?? []) {
      const points: Vec[] = [];
      for (let i = 0; i < loop.length; i += 2) {
        points.push({ x: left + loop[i] * emPx, y: origin.y - loop[i + 1] * emPx });
      }
      outlines.push(points);
    }
    if (char === "i") {
      dots.push({ x: left + DOT.x * emPx, y: origin.y - DOT.y * emPx });
      stemTops.push({ x: left + DOT.x * emPx, y: origin.y - X_HEIGHT * emPx });
    }
  });

  return { emPx, origin, outlines, dots, stemTops, ballPx: DOT.diameter * emPx };
}
