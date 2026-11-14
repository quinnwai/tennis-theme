import { params } from "./params";

/**
 * The trail of a ball in flight: a band of white chips about as wide as the ball. Right behind the
 * ball the chips overlap into one solid band; as they age they shrink and drift off at random, so
 * the band breaks into smaller scattered pieces, and then each chip is gone.
 *
 * This file is only the numbers. It knows nothing about canvases, so it can be tested on its own;
 * `render.ts` draws what `shapes` hands back. Everything per chip lives in typed arrays that are
 * allocated once, so even a crowd of flying balls makes next to no garbage.
 */

/** Slower balls are rolling or resting, not flying, and leave no trail. m/s */
const TRAIL_MIN_SPEED = 1;

/** Whether a ball leaves a trail right now: loose (not a dot, not in the hand) and moving faster than a roll. */
export function leavesTrail(ball: { pinned: boolean; held: boolean; vx: number; vy: number }): boolean {
  return !ball.pinned && !ball.held && ball.vx * ball.vx + ball.vy * ball.vy > TRAIL_MIN_SPEED * TRAIL_MIN_SPEED;
}

/**
 * The most chips alive at once. If a crowd of balls flies together, the oldest chips, the small
 * scattered ones at the far end of each trail, make way, and the solid bands behind the balls stay.
 * Painting is what costs: with 60 balls in flight at once, 4000 chips took about 12 ms a frame in a
 * software renderer at twice the pixel density, and 11,000 took 25.
 */
export const CAPACITY = 4000;

/** A ball that goes unreported this long (ms) has stopped flying; its next report starts a new path. */
const FLIGHT_GAP_MS = 120;

/**
 * The furthest, in ball widths, a ball can turn up from where it was last reported and still be the
 * same flight. No real ball moves this far in a frame; one that does has been put somewhere else
 * (or is not a number), and starts a new path rather than painting a streak. It also keeps the loop
 * that drops chips short, whatever it is handed: at most `MAX_JUMP / MIN_SPACING` chips a call.
 */
const MAX_JUMP = 40;

/** How many balls' paths are kept before ones that have gone quiet are cleared out. */
const MAX_PATHS = 64;

/** Distance between chips along the path, as a share of the average chip size: close enough that new chips overlap into a solid band. */
const SPACING = 0.2;

/** ...but never closer than this many ball widths, so tiny chips cannot pile up thousands per ball. */
const MIN_SPACING = 0.04;

/** The golden ratio's fraction. Stepping through [0, 1) by it spreads chips evenly across the band's width. */
const GOLDEN = 0.6180339887;

/** Where each number about a chip sits in `chips`. */
const X = 0; // where the band's center line was when the chip was dropped, px
const Y = 1;
const TX = 2; // the direction the ball was travelling, a unit vector
const TY = 3;
const CX = 4; // the direction the chip's long side points: the travel direction, turned a little
const CY = 5;
const LANE = 6; // where across the band it sits, -1 to 1
const SIZE = 7; // its thickness against the average chip
const ASPECT = 8; // its length against its thickness
const LIFE = 9; // its life against the full lifetime
const KX = 10; // the way it drifts off, and how far it goes, as a vector no longer than 1
const KY = 11;
const STRIDE = 12;

/** How many numbers `shapes` writes per chip: x, y, half length, half thickness, then the long side's direction (x, y). */
export const SHAPE_STRIDE = 6;

/** A fixed pseudo-random number in [0, 1) for each chip and each question asked about it. The same chip always gets the same answers. */
function noise(chip: number, question: number): number {
  let h = Math.imul(chip ^ Math.imul(question + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Where a ball's path was last seen. */
interface Path {
  x: number;
  y: number;
  t: number;
  /** How far the ball has gone since the last chip was dropped. */
  carry: number;
  /** Chips dropped on this path so far. */
  count: number;
}

export class Trail {
  private chips = new Float32Array(CAPACITY * STRIDE);
  private born = new Float64Array(CAPACITY);
  /** Where `shapes` leaves what to draw. */
  readonly out = new Float32Array(CAPACITY * SHAPE_STRIDE);
  private paths = new Map<number, Path>();
  private tail = 0;
  private size = 0;
  private made = 0;

  /**
   * A ball is at (x, y) at time `now` (ms), `r` pixels in radius. Drops chips along the way it
   * has come since it was last reported. A ball that does not move drops none, and one that was
   * not reported for a while, or has turned up much too far away, starts a new path.
   */
  follow(id: number, x: number, y: number, r: number, now: number): void {
    const path = this.paths.get(id);
    if (!path) {
      if (this.paths.size >= MAX_PATHS) this.forgetStale(now);
      this.paths.set(id, { x, y, t: now, carry: 0, count: 0 });
      return;
    }
    const dx = x - path.x;
    const dy = y - path.y;
    const length = Math.sqrt(dx * dx + dy * dy); // not Math.hypot, which makes garbage every call
    const width = 2 * r;
    if (now - path.t > FLIGHT_GAP_MS || !(length <= MAX_JUMP * width)) {
      path.x = x;
      path.y = y;
      path.t = now;
      path.carry = 0;
      return;
    }
    if (length < 1e-6) {
      path.t = now;
      return;
    }
    const spacing = Math.max(MIN_SPACING * width, SPACING * params.trailPiece * width);
    const tx = dx / length;
    const ty = dy / length;
    let at = spacing - path.carry;
    for (; at <= length; at += spacing) {
      const along = at / length;
      this.drop(path.x + dx * along, path.y + dy * along, path.t + (now - path.t) * along, tx, ty, path.count);
      path.count++;
    }
    path.carry = length - (at - spacing);
    path.x = x;
    path.y = y;
    path.t = now;
  }

  /** Every ball's flight is over: the next report of each starts a new path. Chips already dropped stay. */
  endFlights(): void {
    this.paths.clear();
  }

  /**
   * Work out what to draw at time `now` (ms) for balls `r` pixels in radius. Leaves one entry per
   * living chip in `out` (see `SHAPE_STRIDE`) and returns how many there are.
   */
  shapes(now: number, r: number): number {
    const width = 2 * r;
    const life = params.trailLifetime * 1000;
    // Every chip is gone by the full lifetime, and chips are dropped oldest first.
    while (this.size > 0 && now - this.born[this.tail] >= life) {
      this.tail = (this.tail + 1) % CAPACITY;
      this.size--;
    }
    const band = params.trailWidth * width;
    const average = params.trailPiece * width;
    const scatter = params.trailScatter * width;
    const shrink = params.trailShrink;
    const chips = this.chips;
    const out = this.out;
    let count = 0;
    for (let k = 0; k < this.size; k++) {
      const slot = (this.tail + k) % CAPACITY;
      const o = slot * STRIDE;
      const lifetime = life * chips[o + LIFE];
      const age = Math.max(0, now - this.born[slot]);
      if (age >= lifetime) continue;
      const u = age / lifetime;
      const thickness = average * chips[o + SIZE];
      const length = thickness * chips[o + ASPECT];
      const tx = chips[o + TX];
      const ty = chips[o + TY];
      const cx = chips[o + CX];
      const cy = chips[o + CY];
      // A chip sits at a fixed place across the band, chosen so that when new it fits inside it.
      const reach = 0.5 * (length * Math.abs(tx * cy - ty * cx) + thickness * Math.abs(tx * cx + ty * cy));
      const across = chips[o + LANE] * Math.max(0, band / 2 - reach);
      // It shrinks the whole of its life, and drifts off slowly at first, so the band is whole until it breaks.
      const smaller = Math.pow(1 - u, shrink);
      const drift = scatter * u * Math.sqrt(u);
      const s = count * SHAPE_STRIDE;
      out[s] = chips[o + X] - ty * across + chips[o + KX] * drift;
      out[s + 1] = chips[o + Y] + tx * across + chips[o + KY] * drift;
      out[s + 2] = 0.5 * length * smaller;
      out[s + 3] = 0.5 * thickness * smaller;
      out[s + 4] = cx;
      out[s + 5] = cy;
      count++;
    }
    return count;
  }

  /** Put one chip down, the `nth` along its path. Past `CAPACITY` it takes the place of the oldest. */
  private drop(x: number, y: number, born: number, tx: number, ty: number, nth: number): void {
    const n = this.made++;
    let slot: number;
    if (this.size < CAPACITY) {
      slot = (this.tail + this.size) % CAPACITY;
      this.size++;
    } else {
      slot = this.tail;
      this.tail = (this.tail + 1) % CAPACITY;
    }
    const turn = (noise(n, 0) - 0.5) * 0.5;
    const ct = Math.cos(turn);
    const st = Math.sin(turn);
    const away = noise(n, 1) * Math.PI * 2;
    const far = 0.35 + 0.65 * noise(n, 2);
    const o = slot * STRIDE;
    const chips = this.chips;
    chips[o + X] = x;
    chips[o + Y] = y;
    chips[o + TX] = tx;
    chips[o + TY] = ty;
    chips[o + CX] = tx * ct - ty * st;
    chips[o + CY] = ty * ct + tx * st;
    // Evenly spaced steps through [0, 1), bent so more chips sit toward the band's edges: the middle is covered by everything anyway.
    chips[o + LANE] = -Math.cos(Math.PI * ((nth * GOLDEN) % 1));
    chips[o + SIZE] = 0.6 + 0.8 * noise(n, 3);
    chips[o + ASPECT] = 1 + 1.2 * noise(n, 4);
    chips[o + LIFE] = 0.5 + 0.5 * noise(n, 5);
    chips[o + KX] = Math.cos(away) * far;
    chips[o + KY] = Math.sin(away) * far;
    this.born[slot] = born;
  }

  /** Forget balls that have not been reported lately, so paths of balls long gone do not pile up. */
  private forgetStale(now: number): void {
    for (const [id, path] of this.paths) {
      if (now - path.t > FLIGHT_GAP_MS) this.paths.delete(id);
    }
  }
}
