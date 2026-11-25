import type { Vec } from "./input";
import { params } from "./params";

/** What a press landed on: a can standing in the court, or one standing in the open bag (by its place in the bag). */
export type CanTarget = { kind: "can"; id: number } | { kind: "bag"; index: number };

export interface CanActions {
  /** A quick press and let go without moving: the can pours, or wiggles if it is empty. */
  tap(target: CanTarget, at: Vec): void;
  /** The press moved far enough to be a drag: pick the can up. Returns the id of the can now carried (a can taken out of the bag is a can of the court from then on), or null if it can't be carried now (a pouring can). */
  grab(target: CanTarget, from: Vec, at: Vec): number | null;
  move(id: number, at: Vec): void;
  /** Let go of what was carried. */
  drop(id: number): void;
}

interface Press {
  pointer: number;
  target: CanTarget;
  from: Vec;
  /** When it began, ms of the page's clock (or the court's, when a check has frozen it). */
  t: number;
  /** The can it carries, once it has become a drag. */
  carrying: number | null;
}

/**
 * Quinn-Wai's controls spec for a can: drag moves it, tap makes it act. A press on a can does nothing until it either moves more than
 * `canTapPx` (a drag: the can is carried) or lets go within `canTapMs` without moving that far (a tap: the can pours). One hand: a
 * second press on a can is not taken while the first is down, so that one thumb can carry a can while the other throws a ball.
 */
export class CanHand {
  private press: Press | null = null;

  constructor(private actions: CanActions) {}

  /** Whether this pointer's press is the can hand's. */
  has(pointer: number): boolean {
    return this.press?.pointer === pointer;
  }

  /** Whether the hand is free to take a press on a can. */
  get free(): boolean {
    return this.press === null;
  }

  down(pointer: number, target: CanTarget, at: Vec, t: number): void {
    this.press = { pointer, target, from: at, t, carrying: null };
  }

  move(pointer: number, at: Vec): void {
    const p = this.press;
    if (!p || p.pointer !== pointer) return;
    if (p.carrying === null) {
      if (Math.hypot(at.x - p.from.x, at.y - p.from.y) <= params.canTapPx) return;
      const id = this.actions.grab(p.target, p.from, at);
      if (id === null) {
        this.press = null;
        return;
      }
      p.carrying = id;
    }
    this.actions.move(p.carrying, at);
  }

  up(pointer: number, t: number): void {
    const p = this.press;
    if (!p || p.pointer !== pointer) return;
    this.press = null;
    if (p.carrying !== null) this.actions.drop(p.carrying);
    else if (t - p.t < params.canTapMs) this.actions.tap(p.target, p.from);
  }

  /** The press is lost (the pointer was cancelled, a restart, a new window size): let go of what is carried. */
  cancel(): void {
    const p = this.press;
    this.press = null;
    if (p?.carrying != null) this.actions.drop(p.carrying);
  }
}
