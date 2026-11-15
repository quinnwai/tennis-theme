import { params } from "./params";

/** Screen-space point or vector, in CSS pixels with y pointing down. */
export interface Vec {
  x: number;
  y: number;
}

export interface BallView {
  id: number;
  x: number;
  y: number;
  r: number;
}

/** A can as the gestures see it: a box of half width `halfW` and half height `halfH`, turned by `angle` radians clockwise, centred at (x, y). */
export interface CanView {
  id: number;
  x: number;
  y: number;
  halfW: number;
  halfH: number;
  angle: number;
}

/** How far a point is from a can's outline: 0 on it or inside it. */
export function canGap(can: CanView, point: Vec): number {
  const dx = point.x - can.x;
  const dy = point.y - can.y;
  const cos = Math.cos(can.angle);
  const sin = Math.sin(can.angle);
  // The point in the can's own frame, where the can is upright and its sides are along the axes.
  const across = Math.abs(dx * cos + dy * sin);
  const along = Math.abs(-dx * sin + dy * cos);
  return Math.hypot(Math.max(across - can.halfW, 0), Math.max(along - can.halfH, 0));
}

export interface GestureActions {
  /** A tap landed on or next to a ball or a can. `dir` is a unit vector: the way it should fly. */
  hit(id: number, dir: Vec, at: Vec): void;
  /** A press turned into picking the ball or the can up. For a can, `at` is where it was taken. */
  grab(id: number, at: Vec): void;
  /** The pointer moved while carrying. */
  carry(at: Vec): void;
  /** It was let go. It keeps whatever speed it had. */
  release(): void;
}

/** The way a ball flies when tapped at `point`: away from the tap, or straight up for a dead-center tap. */
export function hitDirection(ball: BallView, point: Vec): Vec {
  const dx = ball.x - point.x;
  const dy = ball.y - point.y;
  const d = Math.hypot(dx, dy);
  if (d < ball.r * 0.2) return { x: 0, y: -1 };
  return { x: dx / d, y: dy / d };
}

type State =
  | { kind: "idle" }
  | { kind: "pending"; id: number; at: Vec; t: number; dir: Vec; canGrab: boolean }
  | { kind: "carrying" };

/**
 * Turns pointer events into the three things you can do to a ball, or to a can of balls:
 * a quick tap hits it, a hold picks it up, and letting go while it moves throws it.
 * Times are in milliseconds.
 */
export class Gestures {
  private state: State = { kind: "idle" };

  constructor(
    private balls: () => BallView[],
    private actions: GestureActions,
    private cans: () => CanView[] = () => [],
  ) {}

  /**
   * A press at (x, y). `touch` says it is a finger, which reaches a little farther than a mouse. Returns whether it
   * landed on a ball or a can, that is, whether a tap, hold or carry has begun for the press to steer. A press on a can itself
   * is the can's, even over a ball that is close by; a press that is on no can goes to the nearest ball in reach, and failing that
   * to a can just beside it (as near as a hold would reach: `minGrabReachPx`, or `touchMinGrabReachPx` for a finger).
   */
  down(x: number, y: number, t: number, touch = false): boolean {
    const at = { x, y };
    const can = this.canAt(at, 0);
    if (can) return this.press(can.id, at, t, can.halfW, true, can);
    const hitFloor = touch ? params.touchMinHitReachPx : params.minHitReachPx;
    const grabFloor = touch ? params.touchMinGrabReachPx : params.minGrabReachPx;
    let best: BallView | undefined;
    let bestDist = Infinity;
    for (const b of this.balls()) {
      const d = Math.hypot(b.x - x, b.y - y);
      const reach = Math.max(b.r * params.hitReach, hitFloor);
      if (d <= reach && d < bestDist) {
        best = b;
        bestDist = d;
      }
    }
    if (!best) {
      const near = this.canAt(at, grabFloor);
      return near ? this.press(near.id, at, t, near.halfW, true, near) : false;
    }
    return this.press(best.id, at, t, best.r, bestDist <= Math.max(best.r * params.grabReach, grabFloor), best);
  }

  /** The can that a point is within `reach` of, the one whose outline is nearest if it is within reach of more than one. */
  private canAt(at: Vec, reach: number): CanView | undefined {
    let best: CanView | undefined;
    let bestGap = Infinity;
    for (const can of this.cans()) {
      const gap = canGap(can, at);
      if (gap <= reach && gap < bestGap) {
        best = can;
        bestGap = gap;
      }
    }
    return best;
  }

  /** Begin a press on a ball or a can. `r` is how big it is (a ball's radius, a can's half width), which tells what counts as a dead-centre tap. */
  private press(id: number, at: Vec, t: number, r: number, canGrab: boolean, target: Vec): true {
    this.state = { kind: "pending", id, at, t, dir: hitDirection({ id, x: target.x, y: target.y, r }, at), canGrab };
    return true;
  }

  move(x: number, y: number): void {
    const s = this.state;
    if (s.kind === "pending") {
      if (Math.hypot(x - s.at.x, y - s.at.y) <= params.tapSlopPx) return;
      if (!s.canGrab) {
        this.state = { kind: "idle" };
        return;
      }
      this.startCarry(s.id, s.at);
    }
    if (this.state.kind === "carrying") this.actions.carry({ x, y });
  }

  /** Call every frame: a press held still past the tap window becomes a pick-up. */
  tick(t: number): void {
    const s = this.state;
    if (s.kind !== "pending" || t - s.t <= params.tapMaxMs) return;
    if (s.canGrab) this.startCarry(s.id, s.at);
    else this.state = { kind: "idle" };
  }

  up(t: number): void {
    const s = this.state;
    this.state = { kind: "idle" };
    if (s.kind === "pending") {
      if (t - s.t <= params.tapMaxMs) this.actions.hit(s.id, s.dir, s.at);
    } else if (s.kind === "carrying") {
      this.actions.release();
    }
  }

  cancel(): void {
    const s = this.state;
    this.state = { kind: "idle" };
    if (s.kind === "carrying") this.actions.release();
  }

  private startCarry(id: number, at: Vec): void {
    this.state = { kind: "carrying" };
    this.actions.grab(id, at);
  }
}
