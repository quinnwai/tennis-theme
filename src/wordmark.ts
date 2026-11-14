import type { Vec } from "./input";
import type { Wordmark } from "./wordmark.data";

/** Share of the window's width the name fills, and the most of its height the name may take. */
const WIDTH_SHARE = 0.62;
const HEIGHT_SHARE = 0.42;

/** How the name sits in the window. Screen space: CSS pixels, y down. */
export interface NameLayout {
  /** Pixels per em. */
  emPx: number;
  /** Left end of the baseline, the point every letter is measured from. */
  origin: Vec;
  /** Each letter's outline as closed loops of points. The i's come without their dots. */
  letters: { char: string; loops: Vec[][] }[];
  /** Where the ball that dots each "i" sits. */
  dots: Vec[];
  /** Top of each i's stem, directly under its dot. */
  stemTops: Vec[];
  /** Diameter of every ball. */
  ballPx: number;
}

/**
 * Center the name in a window of the given size, as large as the width and height shares allow.
 * `ballScale` is how many times wider a ball is than the dot the typeface gives the "i".
 */
export function layoutName(width: number, height: number, mark: Wordmark, ballScale: number): NameLayout {
  const emPx = Math.min((width * WIDTH_SHARE) / mark.width, (height * HEIGHT_SHARE) / (mark.top - mark.bottom));
  const origin = {
    x: (width - mark.width * emPx) / 2,
    y: height / 2 + (mark.xHeight * emPx) / 2,
  };
  const at = (x: number, y: number): Vec => ({ x: origin.x + x * emPx, y: origin.y - y * emPx });

  const letters = mark.letters.map(({ char, loops }) => ({
    char,
    loops: loops.map((loop) => {
      const points: Vec[] = [];
      for (let i = 0; i < loop.length; i += 2) points.push(at(loop[i], loop[i + 1]));
      return points;
    }),
  }));

  const ballEms = mark.dots[0].diameter * ballScale;
  // A larger ball grows upward: it keeps the clear gap above the stem that the typeface gives its dot.
  const dots = mark.dots.map((d) => at(d.x, d.y - d.diameter / 2 + ballEms / 2));
  const stemTops = mark.dots.map((d) => at(d.x, d.stemTop));

  return { emPx, origin, letters, dots, stemTops, ballPx: ballEms * emPx };
}
