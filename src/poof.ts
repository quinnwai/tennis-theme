import { params } from "./params";
import { SHAPE_STRIDE, noise } from "./trail";

/**
 * The poof where a ball is hit: a jagged starburst of the same flat white chips as the trail. It
 * begins as a solid middle with points of mixed lengths, each point a stack of chips that gets
 * narrower toward the tip, and a few long streaks and flecks beyond them. Then it bursts: the
 * chips fly outward and shrink, the points break up, and each chip is gone.
 *
 * Like trail.ts this is only numbers, and it keeps nothing per chip. A burst is just where it
 * happened, when, and a number; every chip of it is worked out again from those each frame, so
 * one burst always looks the same, and the next one looks different.
 */

/**
 * The most bursts alive at once. A burst only comes from a tap, and a person cannot tap more than
 * about ten times a second, so three are alive at most; past this, the oldest gives way.
 */
export const MAX_BURSTS = 8;

const CORE = 5; // chunks in the solid middle
const POINTS = 11; // points of the star
const STEPS = 3; // chips stacked in each point
const STREAKS = 4; // long thin chips thrown off past the points
const FLECKS = 5; // little chips thrown off
export const CHIPS_PER_BURST = CORE + POINTS * STEPS + STREAKS + FLECKS;

/** How far along a point each of its stacked chips reaches, and how wide each is against the first. */
const EDGES = [0, 0.42, 0.76, 1];
const WIDTHS = [1, 0.64, 0.3];

/** Where the points begin, against the size of the star. They overlap the solid middle. */
const ROOT = 0.3;

/**
 * Which questions each chip asks `noise` about its burst. Every kind of chip gets its own block of
 * numbers, worked out from how many of each there are, so that no two chips share an answer
 * however many points or flecks the star is given.
 */
const ASKS_CORE = 5; // how big, how far out, which way out, how squat, how turned
const ASKS_POINT = 3 + STEPS; // which way, how long, how wide, then how turned each step is
const ASKS_STREAK = 4; // which way, how long, how thin, how far out
const ASKS_FLECK = 4; // how big, how far out, which way out, how turned
const Q_CORE = 1; // question 0 is how the whole star is turned
const Q_POINTS = Q_CORE + CORE * ASKS_CORE;
const Q_STREAKS = Q_POINTS + POINTS * ASKS_POINT;
const Q_FLECKS = Q_STREAKS + STREAKS * ASKS_STREAK;

const TAU = Math.PI * 2;

export class Poof {
  /** Where `shapes` leaves what to draw, in the same layout as the trail's. */
  readonly out = new Float32Array(MAX_BURSTS * CHIPS_PER_BURST * SHAPE_STRIDE);
  /** For each burst: x, y, when it happened (ms), and its number. */
  private bursts = new Float64Array(MAX_BURSTS * 4);
  private tail = 0;
  private size = 0;
  private made = 0;

  /** A ball was hit at (x, y) at time `now` (ms). */
  add(x: number, y: number, now: number): void {
    let slot: number;
    if (this.size < MAX_BURSTS) {
      slot = (this.tail + this.size) % MAX_BURSTS;
      this.size++;
    } else {
      slot = this.tail;
      this.tail = (this.tail + 1) % MAX_BURSTS;
    }
    const o = slot * 4;
    this.bursts[o] = x;
    this.bursts[o + 1] = y;
    this.bursts[o + 2] = now;
    this.bursts[o + 3] = this.made++;
  }

  /** How many bursts have not finished at time `now` (ms). */
  live(now: number): number {
    const life = params.poofLifetime * 1000;
    let count = 0;
    for (let k = 0; k < this.size; k++) {
      if (now - this.bursts[((this.tail + k) % MAX_BURSTS) * 4 + 2] < life) count++;
    }
    return count;
  }

  /**
   * Work out what to draw at time `now` (ms) for balls `r` pixels in radius. Leaves one entry per
   * chip in `out` (see `SHAPE_STRIDE`) and returns how many there are.
   */
  shapes(now: number, r: number): number {
    const life = params.poofLifetime * 1000;
    // Every burst lasts the same time, so they finish in the order they began.
    while (this.size > 0 && now - this.bursts[this.tail * 4 + 2] >= life) {
      this.tail = (this.tail + 1) % MAX_BURSTS;
      this.size--;
    }
    const size = params.poofSize * 2.3 * r;
    let count = 0;
    for (let k = 0; k < this.size; k++) {
      const o = ((this.tail + k) % MAX_BURSTS) * 4;
      const age = Math.max(0, now - this.bursts[o + 2]);
      if (age >= life) continue;
      count = this.burst(count, this.bursts[o], this.bursts[o + 1], this.bursts[o + 3], age / life, size);
    }
    return count;
  }

  /** Write the chips of burst number `n`, a fraction `u` of the way through its life, after the first `count`. */
  private burst(count: number, x: number, y: number, n: number, u: number, size: number): number {
    // The whole star is turned a different way each time.
    const spin = noise(n, 0) * TAU;
    // It opens quickly from a little over half its size, holds together while it is new, then flies
    // apart: `flown` is how far out the chips have gone, `left` how much is left of each.
    const open = 0.55 + 0.45 * (1 - Math.pow(1 - Math.min(1, u / 0.18), 3));
    const flown = Math.pow(u, 1.6);
    const left = 1 - u * u;
    const s = size * open;

    // The solid middle: a few overlapping chunks, which collapse first.
    for (let c = 0; c < CORE; c++) {
      const q = Q_CORE + c * ASKS_CORE;
      const half = s * (0.28 + 0.12 * noise(n, q)) * Math.pow(left, 2);
      const distance = s * 0.12 * noise(n, q + 1) + size * 0.05 * flown;
      count = this.put(count, x, y, noise(n, q + 2) * TAU, distance, half, half * (0.7 + 0.3 * noise(n, q + 3)), noise(n, q + 4) * Math.PI);
    }

    // The points: each a stack of chips, narrower toward the tip. Most alternate long and short.
    for (let i = 0; i < POINTS; i++) {
      const q = Q_POINTS + i * ASKS_POINT;
      const angle = spin + ((i + (noise(n, q) - 0.5) * 0.5) * TAU) / POINTS;
      const reach = s * (i % 2 === 0 ? 0.6 + 0.4 * noise(n, q + 1) : 0.25 + 0.2 * noise(n, q + 1));
      const base = s * (0.3 + 0.12 * noise(n, q + 2));
      const kept = Math.pow(left, 1.2);
      for (let step = 0; step < STEPS; step++) {
        const from = s * ROOT + reach * EDGES[step];
        const to = s * ROOT + reach * EDGES[step + 1];
        count = this.put(
          count,
          x,
          y,
          angle,
          (from + to) / 2 + size * 0.6 * flown,
          ((to - from) / 2 + s * 0.02) * kept,
          ((base * WIDTHS[step]) / 2) * kept,
          angle + (noise(n, q + 3 + step) - 0.5) * 0.16,
        );
      }
    }

    // Long thin streaks flung off past the points.
    for (let l = 0; l < STREAKS; l++) {
      const q = Q_STREAKS + l * ASKS_STREAK;
      const angle = noise(n, q) * TAU;
      const length = s * (0.35 + 0.3 * noise(n, q + 1));
      const thick = s * (0.05 + 0.03 * noise(n, q + 2));
      const kept = Math.pow(left, 0.9);
      const from = s * (0.95 + 0.25 * noise(n, q + 3));
      count = this.put(count, x, y, angle, from + length / 2 + size * 1.1 * flown, (length / 2) * kept, (thick / 2) * kept, angle);
    }

    // Little flecks.
    for (let f = 0; f < FLECKS; f++) {
      const q = Q_FLECKS + f * ASKS_FLECK;
      const half = s * (0.035 + 0.035 * noise(n, q)) * left;
      const distance = s * (0.9 + 0.6 * noise(n, q + 1)) + size * 0.8 * flown;
      count = this.put(count, x, y, noise(n, q + 2) * TAU, distance, half, half, noise(n, q + 3) * Math.PI);
    }
    return count;
  }

  /** Write one chip after the first `count`: its middle `distance` from (x, y) along `angle`, its long side turned to `turn`. */
  private put(count: number, x: number, y: number, angle: number, distance: number, halfLength: number, halfThickness: number, turn: number): number {
    const o = count * SHAPE_STRIDE;
    this.out[o] = x + Math.cos(angle) * distance;
    this.out[o + 1] = y + Math.sin(angle) * distance;
    this.out[o + 2] = halfLength;
    this.out[o + 3] = halfThickness;
    this.out[o + 4] = Math.cos(turn);
    this.out[o + 5] = Math.sin(turn);
    return count + 1;
  }
}
