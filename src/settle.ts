import { params } from "./params";

/**
 * What a can does once it is let go. It falls, tips, leans on whatever it lands against, and locks in
 * place. Ported from Quinn-Wai's "Tennis Can Prototype" (canContacts, bodyStep, settleFrame, leanDir, predict). That
 * page only had boxes to land on; here the can lands on the bench, the bag, the letters and what stands in the open bag,
 * all closed outlines. The same code runs ahead of time for the dashed outline that shows where a carried can will rest.
 *
 * Meters and seconds, y up, angles counterclockwise: the court's units. The prototype's numbers were tuned in its own
 * pixels at a softer gravity (1900 px/s²) than the court's real one, so lengths are carried over by the can's size and
 * times by how much faster everything falls here (see `settleConstants`).
 */

export interface Pose {
  x: number;
  y: number;
  a: number;
}

/** A closed outline, its solid side, and the box around it. Meters. */
interface Loop {
  xs: number[];
  ys: number[];
  /** Whether the solid lies to the left of each edge, walking the loop in order (inside an outer loop, outside a hole). */
  solidLeft: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** One solid thing the can can land on: a single outline, or several that never overlap (the name, holes and all). */
export interface Solid {
  loops: Loop[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A ball, or a peg: something round the can leans on. Held still while the can settles. `id`: the ball's, if it is one. */
export interface Disc {
  x: number;
  y: number;
  r: number;
  id?: number;
}

/** Everything a settling can meets: the floor (y = 0), the side walls (x = 0 and x = width), solids and discs. */
export interface SettleWorld {
  width: number;
  height: number;
  /** How far above y = 0 the floor lies (a touch screen lifts it, see `floorLiftFor`). Meters; 0 if left out. */
  floor?: number;
  solids: Solid[];
  discs: Disc[];
}

export interface SettleBody extends Pose {
  vx: number;
  vy: number;
  w: number;
  /** Half the can's width and height. */
  hw: number;
  hh: number;
  calm: number;
  t: number;
  contacts: number;
  ground: boolean;
  prop: boolean;
  /** Which way the lean assist tips it, decided when it first lands: 1 to the right, -1 to the left, 0 not at all. */
  lean: number | null;
  /** The balls (by id) it was touching at the end of its last step: once it locks, the ones it leans on. */
  touching: number[];
}

/** The prototype's numbers, carried over to the court. */
export interface SettleConstants {
  g: number;
  /** Meters per prototype pixel (the prototype's can was 120 px tall). */
  px: number;
  /** How much faster things happen here than in the prototype: the square root of the ratio of the gravities. */
  tf: number;
  slop: number;
  mu: number;
  vmax: number;
  wmax: number;
  leanGap: number;
  ballR: number;
  kick: number;
  leanW: number;
  lockW: number;
  lockV: number;
  calmV: number;
  calmW: number;
  calmT: number;
  tMax: number;
  band: number;
}

/** The can frame: the settle runs in 60 steps a second, as in the prototype, eight small steps each. */
export const FRAME = 1 / 60;
const SUBSTEPS = 8;
const ITERATIONS = 6;

/** The prototype's can was 120 px tall; ours is `canH` meters. */
export function settleConstants(canH: number): SettleConstants {
  const px = canH / 120;
  const tf = Math.sqrt(params.gravity / (1900 * px));
  return {
    g: params.gravity,
    px,
    tf,
    slop: 0.3 * px,
    mu: 0.7,
    vmax: 900 * px * tf,
    wmax: 8 * tf,
    leanGap: 34 * px,
    ballR: params.ballDiameter / 2,
    kick: 0.6 * tf * tf,
    leanW: 1.6 * tf,
    lockW: 6 * tf,
    lockV: 400 * px * tf,
    calmV: 18 * px * tf,
    calmW: 0.3 * tf,
    calmT: 12 / 60 / tf,
    tMax: 4 / tf,
    band: 4 * px,
  };
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Whether a point is inside a loop, counting crossings of a ray to the right. */
function crossings(loop: Loop, x: number, y: number): number {
  let n = 0;
  const { xs, ys } = loop;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if (ys[i] > y !== ys[j] > y && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) n++;
  }
  return n;
}

/**
 * A solid from closed outlines (meters). Outlines inside an odd number of the others are holes, such as the inside of an
 * "a"; the solid side of each is worked out from that and from the way it runs.
 */
export function makeSolid(outlines: { x: number; y: number }[][]): Solid {
  const raw = outlines
    .filter((o) => o.length >= 3)
    .map((o) => {
      const xs = o.map((p) => p.x);
      const ys = o.map((p) => p.y);
      return { xs, ys, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys), solidLeft: true };
    });
  for (const loop of raw) {
    let area = 0;
    for (let i = 0, j = loop.xs.length - 1; i < loop.xs.length; j = i++) area += loop.xs[j] * loop.ys[i] - loop.xs[i] * loop.ys[j];
    const holes = raw.filter((other) => other !== loop && crossings(other, loop.xs[0], loop.ys[0]) % 2 === 1).length;
    const hole = holes % 2 === 1;
    loop.solidLeft = hole ? area < 0 : area > 0;
  }
  return {
    loops: raw,
    minX: Math.min(...raw.map((l) => l.minX)),
    minY: Math.min(...raw.map((l) => l.minY)),
    maxX: Math.max(...raw.map((l) => l.maxX)),
    maxY: Math.max(...raw.map((l) => l.maxY)),
  };
}

/** A can's outline as a solid (other cans standing where they were put). */
export function canSolid(pose: Pose, hw: number, hh: number): Solid {
  const c = Math.cos(pose.a);
  const s = Math.sin(pose.a);
  const pts = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([u, v]) => ({ x: pose.x + u * c - v * s, y: pose.y + u * s + v * c }));
  return makeSolid([pts]);
}

/** Whether a point is inside a solid (outlines and holes together). */
function insideSolid(solid: Solid, x: number, y: number): boolean {
  if (x < solid.minX || x > solid.maxX || y < solid.minY || y > solid.maxY) return false;
  let n = 0;
  for (const loop of solid.loops) if (x >= loop.minX && x <= loop.maxX && y >= loop.minY && y <= loop.maxY) n += crossings(loop, x, y);
  return n % 2 === 1;
}

/**
 * The nearest point of a solid's outline to (x, y) within `margin`, and whether (x, y) is inside the solid, read from the
 * side of that nearest edge it is on. A settling can only ever pokes a little way into anything, so the outline nearby
 * is all that has to be looked at.
 */
function nearestOutline(solid: Solid, x: number, y: number, margin: number): { qx: number; qy: number; d: number; inside: boolean } | null {
  let best = margin * margin;
  let found: { loop: Loop; i: number; t: number; qx: number; qy: number } | null = null;
  for (const loop of solid.loops) {
    if (x < loop.minX - margin || x > loop.maxX + margin || y < loop.minY - margin || y > loop.maxY + margin) continue;
    const { xs, ys } = loop;
    const n = xs.length;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const ax = xs[i];
      const ay = ys[i];
      const bx = xs[j];
      const by = ys[j];
      if (x < Math.min(ax, bx) - margin || x > Math.max(ax, bx) + margin || y < Math.min(ay, by) - margin || y > Math.max(ay, by) + margin) continue;
      const ex = bx - ax;
      const ey = by - ay;
      const len2 = ex * ex + ey * ey;
      const t = len2 > 0 ? clamp(((x - ax) * ex + (y - ay) * ey) / len2, 0, 1) : 0;
      const qx = ax + t * ex;
      const qy = ay + t * ey;
      const d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy);
      if (d2 < best) {
        best = d2;
        found = { loop, i, t, qx, qy };
      }
    }
  }
  if (!found) return null;
  const { loop, i, t, qx, qy } = found;
  const { xs, ys } = loop;
  const n = xs.length;
  const side = (a: number, b: number) => {
    const cross = (xs[b] - xs[a]) * (y - ys[a]) - (ys[b] - ys[a]) * (x - xs[a]);
    return cross > 0 === loop.solidLeft;
  };
  let inside: boolean;
  if (t > 1e-9 && t < 1 - 1e-9) {
    inside = side(i, (i + 1) % n);
  } else {
    // nearest to a corner: inside a corner that juts out means inside both edges; inside one that is cut in, either
    const v = t <= 1e-9 ? i : (i + 1) % n;
    const p = (v - 1 + n) % n;
    const q = (v + 1) % n;
    const turn = (xs[v] - xs[p]) * (ys[q] - ys[v]) - (ys[v] - ys[p]) * (xs[q] - xs[v]);
    const juts = turn > 0 === loop.solidLeft;
    const a = side(p, v);
    const b = side(v, q);
    inside = juts ? a && b : a || b;
  }
  return { qx, qy, d: Math.sqrt(best), inside };
}

interface ContactPoint {
  px: number;
  py: number;
  nx: number;
  ny: number;
  pen: number;
  ground: boolean;
  rx: number;
  ry: number;
  jn: number;
  jt: number;
  /** The ball it is with, if it is one. */
  ball?: number;
}

/** How far into the outline nearby a can's corner is looked for: well past any step's worth of travel. */
const MARGIN = 0.03;

function canContacts(b: SettleBody, world: SettleWorld): ContactPoint[] {
  const c = Math.cos(b.a);
  const s = Math.sin(b.a);
  const out: ContactPoint[] = [];
  const floor = world.floor ?? 0;
  const add = (px: number, py: number, nx: number, ny: number, pen: number, ground: boolean, ball?: number) =>
    out.push({ px, py, nx, ny, pen, ground, rx: px - b.x, ry: py - b.y, jn: 0, jt: 0, ball });
  const ext = b.hw + b.hh;
  const box = { minX: b.x - ext, maxX: b.x + ext, minY: b.y - ext, maxY: b.y + ext };
  const near = world.solids.filter(
    (sd) => sd.maxX >= box.minX - MARGIN && sd.minX <= box.maxX + MARGIN && sd.maxY >= box.minY - MARGIN && sd.minY <= box.maxY + MARGIN,
  );

  // the can's corners in the floor, the walls or a solid
  for (const [u, v] of [
    [-b.hw, -b.hh],
    [b.hw, -b.hh],
    [b.hw, b.hh],
    [-b.hw, b.hh],
  ]) {
    const x = b.x + u * c - v * s;
    const y = b.y + u * s + v * c;
    if (y < floor) add(x, y, 0, 1, floor - y, true);
    // the top of the page is a ceiling: a can thrown hard cannot sail off it and lodge against a wall where nobody can see or reach it
    if (y > world.height) add(x, y, 0, -1, y - world.height, false);
    if (x < 0) add(x, y, 1, 0, -x, false);
    if (x > world.width) add(x, y, -1, 0, x - world.width, false);
    for (const sd of near) {
      const hit = nearestOutline(sd, x, y, MARGIN);
      if (!hit || !hit.inside) continue;
      let nx: number;
      let ny: number;
      if (hit.d > 1e-9) {
        nx = (hit.qx - x) / hit.d;
        ny = (hit.qy - y) / hit.d;
      } else {
        nx = 0;
        ny = 1;
      }
      add(x, y, nx, ny, hit.d, ny > 0.7);
    }
  }

  // corners of a solid poking into the can's side (leaning on an edge)
  for (const sd of near) {
    for (const loop of sd.loops) {
      if (loop.maxX < box.minX || loop.minX > box.maxX || loop.maxY < box.minY || loop.minY > box.maxY) continue;
      const { xs, ys } = loop;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - b.x;
        const dy = ys[i] - b.y;
        if (Math.abs(dx) > ext || Math.abs(dy) > ext) continue;
        const lu = dx * c + dy * s;
        const lv = -dx * s + dy * c;
        if (Math.abs(lu) >= b.hw || Math.abs(lv) >= b.hh) continue;
        const pu = b.hw - Math.abs(lu);
        const pv = b.hh - Math.abs(lv);
        let nu = 0;
        let nv = 0;
        let pen: number;
        if (pu < pv) {
          nu = Math.sign(lu) || 1;
          pen = pu;
        } else {
          nv = Math.sign(lv) || 1;
          pen = pv;
        }
        // the can's face there points (wx, wy); it is pushed the other way
        const wx = nu * c - nv * s;
        const wy = nu * s + nv * c;
        add(xs[i], ys[i], -wx, -wy, pen, false);
      }
    }
  }

  // balls and pegs hold the can up; they don't get pushed while it settles
  for (const d of world.discs) {
    const dx = d.x - b.x;
    const dy = d.y - b.y;
    if (Math.abs(dx) > ext + d.r || Math.abs(dy) > ext + d.r) continue;
    const lu = dx * c + dy * s;
    const lv = -dx * s + dy * c;
    const cu = clamp(lu, -b.hw, b.hw);
    const cv = clamp(lv, -b.hh, b.hh);
    const du = lu - cu;
    const dv = lv - cv;
    const dist = Math.hypot(du, dv);
    if (dist >= d.r) continue;
    if (dist < 1e-9) {
      // its middle is inside the can: the can goes out by the nearest face
      const pu = b.hw - Math.abs(lu);
      const pv = b.hh - Math.abs(lv);
      const nu = pu < pv ? Math.sign(lu) || 1 : 0;
      const nv = pu < pv ? 0 : Math.sign(lv) || 1;
      const fu = nu ? nu * b.hw : lu;
      const fv = nv ? nv * b.hh : lv;
      add(b.x + fu * c - fv * s, b.y + fu * s + fv * c, -(nu * c - nv * s), -(nu * s + nv * c), (pu < pv ? pu : pv) + d.r, false, d.id);
      continue;
    }
    const nu = du / dist;
    const nv = dv / dist;
    const wx = nu * c - nv * s;
    const wy = nu * s + nv * c;
    add(b.x + cu * c - cv * s, b.y + cu * s + cv * c, -wx, -wy, d.r - dist, false, d.id);
  }
  return out;
}

/** Push a can out of whatever it is still poking into, without changing its speed: done when it locks, so it never
 * stands sunk into the floor or a ball. */
function tidy(b: SettleBody, world: SettleWorld, K: SettleConstants): void {
  for (let i = 0; i < 8; i++) {
    const cs = canContacts(b, world);
    let worst = 0;
    for (const ct of cs) {
      const k = Math.max(ct.pen - K.slop, 0) * 0.5;
      worst = Math.max(worst, ct.pen);
      b.x += ct.nx * k;
      b.y += ct.ny * k;
    }
    if (worst <= K.slop * 2) break;
  }
}

function bodyStep(b: SettleBody, h: number, world: SettleWorld, K: SettleConstants): ContactPoint[] {
  b.vy -= K.g * h;
  b.x += b.vx * h;
  b.y += b.vy * h;
  b.a += b.w * h;
  const cs = canContacts(b, world);
  b.contacts = cs.length;
  b.touching = [];
  for (const ct of cs) {
    if (ct.ground) b.ground = true;
    else b.prop = true;
    if (ct.ball !== undefined && !b.touching.includes(ct.ball)) b.touching.push(ct.ball);
  }
  const im = 1;
  const ii = 12 / ((2 * b.hw) ** 2 + (2 * b.hh) ** 2);
  for (let it = 0; it < ITERATIONS; it++) {
    for (const ct of cs) {
      const vpx = b.vx - b.w * ct.ry;
      const vpy = b.vy + b.w * ct.rx;
      const vn = vpx * ct.nx + vpy * ct.ny;
      const rn = ct.rx * ct.ny - ct.ry * ct.nx;
      let dj = -vn / (im + rn * rn * ii);
      const jn = Math.max(ct.jn + dj, 0);
      dj = jn - ct.jn;
      ct.jn = jn;
      b.vx += dj * ct.nx * im;
      b.vy += dj * ct.ny * im;
      b.w += rn * dj * ii;
      const tx = -ct.ny;
      const ty = ct.nx;
      const vpx2 = b.vx - b.w * ct.ry;
      const vpy2 = b.vy + b.w * ct.rx;
      const vt = vpx2 * tx + vpy2 * ty;
      const rt = ct.rx * ty - ct.ry * tx;
      let djt = -vt / (im + rt * rt * ii);
      const jt = clamp(ct.jt + djt, -K.mu * ct.jn, K.mu * ct.jn);
      djt = jt - ct.jt;
      ct.jt = jt;
      b.vx += djt * tx * im;
      b.vy += djt * ty * im;
      b.w += rt * djt * ii;
    }
  }
  for (const ct of cs) {
    const k = Math.max(ct.pen - K.slop, 0) * 0.35;
    b.x += ct.nx * k;
    b.y += ct.ny * k;
  }
  return cs;
}

/**
 * Lean assist: when the can first lands, look for something close beside its base (a ball, the side of the bench or the
 * bag, a letter, a wall). If there is one, tip the can toward it, so it leans there. 1 is to the right, -1 the left.
 */
function leanDir(b: SettleBody, world: SettleWorld, K: SettleConstants): number {
  const base = b.y - b.hh;
  const top = b.y + b.hh;
  let best = K.leanGap;
  let dir = 0;
  const consider = (gap: number, d: number) => {
    if (gap > -K.ballR && gap < best) {
      best = gap;
      dir = d;
    }
  };
  for (const d of world.discs) {
    if (d.y < base - d.r || d.y > base + 3 * d.r) continue;
    consider(Math.abs(d.x - b.x) - b.hw - d.r, d.x > b.x ? 1 : -1);
  }
  // what stands up beside it: each outline's edges, cut to the can's height (from a little above its base to its top)
  const y0 = base + K.band;
  for (const sd of world.solids) {
    if (sd.maxY < y0 || sd.minY > top) continue;
    for (const loop of sd.loops) {
      if (loop.maxY < y0 || loop.minY > top) continue;
      const { xs, ys } = loop;
      for (let i = 0; i < xs.length; i++) {
        const j = i + 1 === xs.length ? 0 : i + 1;
        const [ax, ay, bx, by] = [xs[i], ys[i], xs[j], ys[j]];
        if ((ay < y0 && by < y0) || (ay > top && by > top)) continue;
        let t0 = 0;
        let t1 = 1;
        if (ay !== by) {
          const ta = (y0 - ay) / (by - ay);
          const tb = (top - ay) / (by - ay);
          t0 = Math.max(0, Math.min(ta, tb));
          t1 = Math.min(1, Math.max(ta, tb));
          if (t0 > t1) continue;
        }
        const xa = ax + (bx - ax) * t0;
        const xb = ax + (bx - ax) * t1;
        const lo = Math.min(xa, xb);
        const hi = Math.max(xa, xb);
        if (lo >= b.x) consider(lo - (b.x + b.hw), 1);
        else if (hi <= b.x) consider(b.x - b.hw - hi, -1);
      }
    }
  }
  consider(b.x - b.hw, -1);
  consider(world.width - (b.x + b.hw), 1);
  return dir;
}

/** A can let go at `pose`, moving at (vx, vy) m/s and turning at w rad/s. */
export function newBody(pose: Pose, vx: number, vy: number, w: number, hw: number, hh: number, K: SettleConstants): SettleBody {
  return {
    x: pose.x,
    y: pose.y,
    a: pose.a,
    vx: clamp(vx, -K.vmax, K.vmax),
    vy: clamp(vy, -K.vmax, K.vmax),
    w: clamp(w, -K.wmax, K.wmax),
    hw,
    hh,
    calm: 0,
    t: 0,
    contacts: 0,
    ground: false,
    prop: false,
    lean: null,
    touching: [],
  };
}

/** One frame of settling. Returns true once the can has come to rest (then it locks). */
export function settleFrame(b: SettleBody, world: SettleWorld, K: SettleConstants): boolean {
  b.ground = false;
  b.prop = false;
  for (let i = 0; i < SUBSTEPS; i++) bodyStep(b, FRAME / SUBSTEPS, world, K);
  b.t += FRAME;
  if (b.ground && b.lean === null) b.lean = Math.abs(wrap(b.a)) < 0.5 ? leanDir(b, world, K) : 0;
  // a gentle push toward the prop: tipping to the right (1) is clockwise, a falling angle
  if (b.lean && !b.prop) {
    const s = -b.lean;
    if (s * b.a < 1.2 && s * b.w < K.leanW) b.w += s * K.kick;
  }
  // lean lock: standing on a surface and resting against something, tilted, not moving fast
  const tilt = Math.abs(wrap(b.a));
  if (b.ground && b.prop && tilt > 0.12 && tilt < 1.35 && Math.abs(b.w) < K.lockW && Math.hypot(b.vx, b.vy) < K.lockV) {
    b.vx = 0;
    b.vy = 0;
    b.w = 0;
    tidy(b, world, K);
    return true;
  }
  if (b.contacts > 0 && Math.hypot(b.vx, b.vy) < K.calmV && Math.abs(b.w) < K.calmW) b.calm++;
  else b.calm = 0;
  // the prototype's time limit, but never in mid-air: a can still falling then keeps falling (up to three times as long)
  const done = b.calm * FRAME >= K.calmT || (b.t > K.tMax && b.contacts > 0) || b.t > 3 * K.tMax;
  if (done) tidy(b, world, K);
  return done;
}

// ---- let go overlapping something ----

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Whether a can at `pose` overlaps any solid. */
export function overlapsSolids(pose: Pose, hw: number, hh: number, world: SettleWorld, discs = false): boolean {
  const c = Math.cos(pose.a);
  const s = Math.sin(pose.a);
  // `discs`: a ball or peg sunk into it by more than a millimeter counts too
  if (discs) {
    for (const d of world.discs) {
      const dx = d.x - pose.x;
      const dy = d.y - pose.y;
      const lu = dx * c + dy * s;
      const lv = -dx * s + dy * c;
      if (Math.hypot(lu - clamp(lu, -hw, hw), lv - clamp(lv, -hh, hh)) < d.r - 0.001) return true;
    }
  }
  const corners = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([u, v]) => [pose.x + u * c - v * s, pose.y + u * s + v * c]);
  const ext = hw + hh;
  for (const sd of world.solids) {
    if (sd.maxX < pose.x - ext || sd.minX > pose.x + ext || sd.maxY < pose.y - ext || sd.minY > pose.y + ext) continue;
    if (corners.some(([x, y]) => insideSolid(sd, x, y))) return true;
    for (const loop of sd.loops) {
      const { xs, ys } = loop;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - pose.x;
        const dy = ys[i] - pose.y;
        if (Math.abs(dx * c + dy * s) < hw && Math.abs(-dx * s + dy * c) < hh) return true;
        const j = i + 1 === xs.length ? 0 : i + 1;
        for (let k = 0; k < 4; k++) {
          const [ax, ay] = corners[k];
          const [bx, by] = corners[(k + 1) % 4];
          if (segmentsCross(ax, ay, bx, by, xs[i], ys[i], xs[j], ys[j])) return true;
        }
      }
    }
  }
  return false;
}

/** Ways out of an overlap, tried in this order at each distance: straight up first, down last. */
const WAYS_OUT = [
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
];

/**
 * A can let go overlapping something (a carried can passes through everything) never settles inside it: it starts its
 * fall from the nearest spot that is clear, straight up when that is as near as any. Over the bench or a letter that is
 * on top of it; over the bag, which stands under the name with less than a can's height to spare, beside it.
 */
export function clearSpot(pose: Pose, hw: number, hh: number, world: SettleWorld): Pose {
  if (!overlapsSolids(pose, hw, hh, world, true)) return pose;
  const across = hw * Math.abs(Math.cos(pose.a)) + hh * Math.abs(Math.sin(pose.a));
  const up = hw * Math.abs(Math.sin(pose.a)) + hh * Math.abs(Math.cos(pose.a));
  const free = (x: number, y: number) =>
    x >= across && x <= world.width - across && y >= (world.floor ?? 0) + up && !overlapsSolids({ ...pose, x, y }, hw, hh, world, true);
  const step = 0.01;
  for (let d = step; d <= 1.5; d += step) {
    for (const [ux, uy] of WAYS_OUT) {
      if (!free(pose.x + ux * d, pose.y + uy * d)) continue;
      // the nearest clear point along that way, to a fraction of a millimeter
      let lo = d - step;
      let hi = d;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (free(pose.x + ux * mid, pose.y + uy * mid)) hi = mid;
        else lo = mid;
      }
      return { ...pose, x: pose.x + ux * hi, y: pose.y + uy * hi };
    }
  }
  return pose;
}

/** Where a can let go at `pose` with that speed will end up: the same sim a real let go runs, ahead of time. `assist`:
 * whether the lean assist may tip it toward something beside it (not for the heavy trophy). */
export function predictRest(
  pose: Pose,
  vx: number,
  vy: number,
  w: number,
  hw: number,
  hh: number,
  world: SettleWorld,
  K: SettleConstants,
  assist = true,
): SettleBody {
  const b = newBody(clearSpot(pose, hw, hh, world), vx, vy, w, hw, hh, K);
  if (!assist) b.lean = 0;
  for (let i = 0; i < 800; i++) if (settleFrame(b, world, K)) break;
  return b;
}
