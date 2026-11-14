import { Chain, Circle, Edge, Settings, World, type Body } from "planck";
import { params } from "./params";

/**
 * The engine is tuned for bodies between 0.1 and 10 units across, and a tennis ball
 * is 0.067 m. So one engine unit is 10 cm, and everything crossing this file's
 * boundary is converted to and from meters.
 */
const UNITS_PER_METER = 10;
const U = UNITS_PER_METER;

/**
 * Seconds of simulated time per physics step. Small on purpose: the speed below which a bounce
 * has to be treated as dead (see below) shrinks with the step, and at 1/240 s the last bounce
 * that gets cut off is about a pixel high.
 */
export const STEP = 1 / 240;

/**
 * The slowest impact that still bounces, in m/s.
 *
 * Stepping in fixed slices of time adds up to one slice of gravity to every impact. That is
 * enough to keep a ball hopping forever at gravity * STEP / (1 - restitution), about 0.32 m/s
 * with the default numbers. Treating impacts comfortably above that speed as dead lets the ball
 * come to rest. In a sweep of 2000 drops, a margin of 1.25 still left 2 balls hopping and 1.6
 * left none. The last bounce this removes would have risen under 1 cm.
 */
function deadBounceSpeed(): number {
  return (1.6 * params.gravity * STEP) / (1 - params.restitution);
}

/** A ball as the rest of the app sees it: meters and m/s, y up, origin at the bottom-left corner. */
export interface Ball {
  readonly id: number;
  x: number;
  y: number;
  angle: number;
  /** Where the ball was one step ago, for smooth drawing between steps. */
  prevX: number;
  prevY: number;
  prevAngle: number;
  vx: number;
  vy: number;
  /** Sitting in place as the dot of an "i", untouched so far. */
  pinned: boolean;
  /** Being carried by the pointer. */
  held: boolean;
}

/** Whether the body is resting on or rubbing against the floor, a wall or a letter. */
function onSurface(body: Body): boolean {
  for (let edge = body.getContactList(); edge; edge = edge.next) {
    if (edge.contact.isTouching() && edge.other?.isStatic()) return true;
  }
  return false;
}

/**
 * The playing space: a floor and two side walls as tall as the window, open at the top,
 * with the letters of the name standing in it as solid shapes.
 */
export class Court {
  readonly balls: Ball[] = [];
  private world: World;
  private bodies = new Map<number, Body>();
  private nextId = 1;
  private heldId: number | null = null;
  private target = { x: 0, y: 0 };

  /**
   * `letters` are closed outlines, each a loop of points in meters. `pegs` are solid discs,
   * such as the contact button in the corner.
   */
  constructor(
    private width: number,
    height: number,
    letters: { x: number; y: number }[][] = [],
    pegs: { x: number; y: number; radius: number }[] = [],
  ) {
    Settings.velocityThreshold = deadBounceSpeed() * U;
    this.world = new World({ gravity: { x: 0, y: -params.gravity * U } });
    const walls = this.world.createBody();
    const surface = { friction: params.friction };
    const w = width * U;
    const h = height * U;
    walls.createFixture(new Edge({ x: 0, y: 0 }, { x: w, y: 0 }), surface);
    walls.createFixture(new Edge({ x: 0, y: 0 }, { x: 0, y: h }), surface);
    walls.createFixture(new Edge({ x: w, y: 0 }, { x: w, y: h }), surface);
    for (const loop of letters) {
      const points = loop.map((p) => ({ x: p.x * U, y: p.y * U }));
      walls.createFixture(new Chain(points, true), surface);
    }
    for (const peg of pegs) {
      walls.createFixture(new Circle({ x: peg.x * U, y: peg.y * U }, peg.radius * U), surface);
    }
  }

  addBall(x: number, y: number, pinned: boolean): Ball {
    const body = this.world.createBody({
      type: "dynamic",
      position: { x: x * U, y: y * U },
      bullet: true,
      gravityScale: pinned ? 0 : 1,
    });
    body.createFixture(new Circle((params.ballDiameter / 2) * U), {
      density: 1,
      friction: params.friction,
      restitution: params.restitution,
    });
    const ball: Ball = {
      id: this.nextId++,
      x,
      y,
      angle: 0,
      prevX: x,
      prevY: y,
      prevAngle: 0,
      vx: 0,
      vy: 0,
      pinned,
      held: false,
    };
    this.balls.push(ball);
    this.bodies.set(ball.id, body);
    return ball;
  }

  /** Send a ball flying along a unit direction, as if struck. */
  hit(id: number, dirX: number, dirY: number): void {
    const ball = this.balls.find((b) => b.id === id);
    const body = this.bodies.get(id);
    if (!ball || !body || ball.held) return;
    this.unpin(ball, body);
    const v = body.getLinearVelocity();
    body.setLinearVelocity({
      x: dirX * params.hitSpeed * U + v.x * params.hitCarryOver,
      y: dirY * params.hitSpeed * U + v.y * params.hitCarryOver,
    });
  }

  /** Pick a ball up. It follows `carryTo` until `release`. */
  grab(id: number): void {
    const ball = this.balls.find((b) => b.id === id);
    const body = this.bodies.get(id);
    if (!ball || !body) return;
    this.unpin(ball, body);
    ball.held = true;
    this.heldId = id;
    body.setGravityScale(0);
    this.target = { x: ball.x, y: ball.y };
  }

  carryTo(x: number, y: number): void {
    this.target = { x, y };
  }

  /** Let go of the carried ball with the given velocity, capped at the fastest allowed throw. */
  release(vx: number, vy: number): void {
    if (this.heldId === null) return;
    const ball = this.balls.find((b) => b.id === this.heldId);
    const body = this.bodies.get(this.heldId);
    this.heldId = null;
    if (!ball || !body) return;
    ball.held = false;
    body.setGravityScale(1);
    const speed = Math.hypot(vx, vy);
    const scale = speed > params.maxFling ? params.maxFling / speed : 1;
    body.setLinearVelocity({ x: vx * scale * U, y: vy * scale * U });
    body.setAwake(true);
  }

  /** Advance the world by one `STEP`. Returns the ids of balls that left for good. */
  step(): number[] {
    const dt = STEP;
    const radius = params.ballDiameter / 2;

    for (const ball of this.balls) {
      const body = this.bodies.get(ball.id)!;
      ball.prevX = ball.x;
      ball.prevY = ball.y;
      ball.prevAngle = ball.angle;

      if (ball.held) {
        // The carried ball chases the pointer rather than teleporting, so it still pushes and collides.
        const p = body.getPosition();
        body.setLinearVelocity({
          x: (this.target.x * U - p.x) * params.followRate,
          y: (this.target.y * U - p.y) * params.followRate,
        });
        body.setAngularVelocity(0);
      } else if (!ball.pinned && body.isAwake()) {
        // Air drag grows with the square of speed. Below 0.5 m/s it is too small to matter.
        const v = body.getLinearVelocity();
        const speed = Math.hypot(v.x, v.y) / U;
        if (speed > 0.5) {
          const keep = Math.max(0, 1 - params.drag * speed * dt);
          body.setLinearVelocity({ x: v.x * keep, y: v.y * keep });
        }
        // A rolling ball slows at a steady rate, as on a real court, instead of creeping forever.
        if (onSurface(body)) {
          const spin = body.getAngularVelocity();
          const loss = ((2 * params.rollingResistance * params.gravity) / radius) * dt;
          body.setAngularVelocity(Math.abs(spin) <= loss ? 0 : spin - Math.sign(spin) * loss);
        }
      }
    }

    this.world.step(dt, 8, 3);

    const gone: number[] = [];
    for (const ball of this.balls) {
      const body = this.bodies.get(ball.id)!;
      const p = body.getPosition();
      const v = body.getLinearVelocity();
      ball.x = p.x / U;
      ball.y = p.y / U;
      ball.angle = body.getAngle();
      ball.vx = v.x / U;
      ball.vy = v.y / U;
      // A dot knocked by another ball comes loose.
      if (ball.pinned && Math.hypot(ball.vx, ball.vy) > 0.05) this.unpin(ball, body);
      // The side walls stop at the top of the window. Past the side lines, a ball is out.
      if (ball.x < -radius || ball.x > this.width + radius) gone.push(ball.id);
    }
    for (const id of gone) this.remove(id);
    return gone;
  }

  /** Re-read the tunable numbers after they change. */
  applyParams(): void {
    Settings.velocityThreshold = deadBounceSpeed() * U;
    this.world.setGravity({ x: 0, y: -params.gravity * U });
    for (const body of this.bodies.values()) {
      for (let f = body.getFixtureList(); f; f = f.getNext()) {
        f.setRestitution(params.restitution);
        f.setFriction(params.friction);
      }
      body.setAwake(true);
    }
  }

  private unpin(ball: Ball, body: Body): void {
    if (!ball.pinned) return;
    ball.pinned = false;
    body.setGravityScale(1);
    body.setAwake(true);
  }

  private remove(id: number): void {
    const body = this.bodies.get(id);
    if (body) this.world.destroyBody(body);
    this.bodies.delete(id);
    const index = this.balls.findIndex((b) => b.id === id);
    if (index >= 0) this.balls.splice(index, 1);
    if (this.heldId === id) this.heldId = null;
  }
}
