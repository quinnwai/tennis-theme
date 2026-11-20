/** A point or a size in meters, y up, origin at the bottom-left corner of the window (the physics' own space). */
export interface Point {
  x: number;
  y: number;
}

/** An upright box in the same space. */
export interface Rect {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/** The four corners of a box, as a convex outline. */
export function boxOutline({ left, bottom, right, top }: Rect): Point[] {
  return [
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: right, y: top },
    { x: left, y: top },
  ];
}

/** The smallest upright box round a set of points. */
export function boundsOf(points: Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
}

/** Whether two boxes share any room. Boxes that only touch do not. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top;
}

/** A box grown by `by` on every side. */
export function grown(r: Rect, by: number): Rect {
  return { left: r.left - by, bottom: r.bottom - by, right: r.right + by, top: r.top + by };
}

/** The points of a closed outline with more put in between, so that no two neighbours are more than `step` apart. */
export function densify(loop: Point[], step: number): Point[] {
  const out: Point[] = [];
  loop.forEach((from, i) => {
    const to = loop[(i + 1) % loop.length];
    const pieces = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step));
    for (let k = 0; k < pieces; k++) out.push({ x: from.x + ((to.x - from.x) * k) / pieces, y: from.y + ((to.y - from.y) * k) / pieces });
  });
  return out;
}
