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

export interface GestureActions {
  /** A tap landed on or next to a ball. `dir` is a unit vector: the way the ball should fly. */
  hit(id: number, dir: Vec, at: Vec): void;
  /** A press turned into picking the ball up. */
  grab(id: number, at: Vec): void;
  /** The pointer moved while carrying a ball. */
  carry(at: Vec): void;
  /** The ball was let go. It keeps whatever speed it had. */
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
 * Turns pointer events into the three things you can do to a ball:
 * a quick tap hits it, a hold picks it up, and letting go while it moves throws it.
 * Times are in milliseconds.
 */
export class Gestures {
  private state: State = { kind: "idle" };

  constructor(
    private balls: () => BallView[],
    private actions: GestureActions,
  ) {}

  down(x: number, y: number, t: number): void {
    let best: BallView | undefined;
    let bestDist = Infinity;
    for (const b of this.balls()) {
      const d = Math.hypot(b.x - x, b.y - y);
      const reach = Math.max(b.r * params.hitReach, params.minHitReachPx);
      if (d <= reach && d < bestDist) {
        best = b;
        bestDist = d;
      }
    }
    if (!best) return;
    const at = { x, y };
    this.state = {
      kind: "pending",
      id: best.id,
      at,
      t,
      dir: hitDirection(best, at),
      canGrab: bestDist <= Math.max(best.r * params.grabReach, params.minGrabReachPx),
    };
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
