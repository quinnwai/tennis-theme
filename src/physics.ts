import { Chain, Circle, Edge, Settings, World, type Body, type Contact } from "planck";
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

/** A ball striking something: the floor, a wall, a letter, a button or another ball. */
export interface Impact {
  /** How fast the two were closing along the line between them at the moment they met, in m/s. */
  speed: number;
}

/**
 * How long a ball has to go without meeting anything new before its next meeting counts as an impact, in
 * seconds. A carried ball pressed into a wall is pushed back out and driven into it again at every step,
 * which would otherwise be a fresh impact 240 times a second; so would the last tiny hops of a settling
 * ball. A real bounce takes longer than this: even one at 0.3 m/s, the slowest that still bounces, is in
 * the air for about 60 ms.
 */
const QUIET = 0.03;

/**
 * A meeting inside that quiet spell still counts if it is this many times harder than the hardest one that
 * counted since the ball was last free. Otherwise a graze along the edge of a letter would swallow the
 * knock that follows it a few milliseconds later, and a hard impact would sound like the graze.
 */
const HARDER = 1.5;

/** A contact that has just begun, before the step is over and the strongest of them are picked. */
interface Meeting {
  /** The balls in it: two for a ball meeting a ball, one for a ball meeting anything fixed. */
  balls: number[];
  speed: number;
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
  /**
   * What the latest `step()` struck, one entry for each time a ball met something new, strongest first.
   * A ball that rests on something or rolls along it meets nothing new, so it adds nothing; a ball that
   * touches two things in the same instant, such as the corner of a letter, counts once; and a ball that
   * keeps meeting something again and again (see `QUIET` and `HARDER`) counts only the first time, and
   * again for anything much harder.
   */
  readonly impacts: Impact[] = [];
  private world: World;
  private bodies = new Map<number, Body>();
  private nextId = 1;
  private heldId: number | null = null;
  private target = { x: 0, y: 0 };
  private meetings: Meeting[] = [];
  private time = 0; // seconds of simulated time
  /** For each ball: when it last met something new, and the hardest meeting that counted since it was last free. */
  private lastMet = new Map<number, { at: number; hardest: number }>();

  /**
   * `letters` are closed outlines, each a loop of points in meters. `pegs` are solid discs,
   * such as the contact button in the corner. `floor` is how far above the bottom of the window
   * the floor lies, in meters: 0 puts it at the window's edge, and a phone lifts it clear of the
   * strip along the screen's bottom edge where a press is taken for the system's own swipe.
   */
  constructor(
    private width: number,
    height: number,
    letters: { x: number; y: number }[][] = [],
    pegs: { x: number; y: number; radius: number }[] = [],
    floor = 0,
  ) {
    Settings.velocityThreshold = deadBounceSpeed() * U;
    this.world = new World({ gravity: { x: 0, y: -params.gravity * U } });
    const walls = this.world.createBody();
    const surface = { friction: params.friction };
    const w = width * U;
    const h = height * U;
    walls.createFixture(new Edge({ x: 0, y: floor * U }, { x: w, y: floor * U }), surface);
    walls.createFixture(new Edge({ x: 0, y: 0 }, { x: 0, y: h }), surface);
    walls.createFixture(new Edge({ x: w, y: 0 }, { x: w, y: h }), surface);
    for (const loop of letters) {
      const points = loop.map((p) => ({ x: p.x * U, y: p.y * U }));
      walls.createFixture(new Chain(points, true), surface);
    }
    for (const peg of pegs) {
      walls.createFixture(new Circle({ x: peg.x * U, y: peg.y * U }, peg.radius * U), surface);
    }
    this.world.on("begin-contact", (contact) => this.noteMeeting(contact));
  }

  addBall(x: number, y: number, pinned: boolean): Ball {
    const id = this.nextId++;
    const body = this.world.createBody({
      type: "dynamic",
      position: { x: x * U, y: y * U },
      bullet: true,
      gravityScale: pinned ? 0 : 1,
      userData: id, // how a contact tells a ball from the walls, which have none
    });
    body.createFixture(new Circle((params.ballDiameter / 2) * U), {
      density: 1,
      friction: params.friction,
      restitution: params.restitution,
    });
    const ball: Ball = {
      id,
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
    // A ball in the hand does not bounce. It chases the pointer at a speed set by the gap, and if the
    // pointer is somewhere it cannot go, say inside the floor, that speed would be bounced back
    // as soon as it let go and look like a throw.
    this.setBounce(body, 0);
    this.target = { x: ball.x, y: ball.y };
  }

  carryTo(x: number, y: number): void {
    this.target = { x, y };
  }

  /** Let go of the carried ball. It keeps the speed it had, which is how a throw happens. */
  release(): void {
    if (this.heldId === null) return;
    const ball = this.balls.find((b) => b.id === this.heldId);
    const body = this.bodies.get(this.heldId);
    this.heldId = null;
    if (!ball || !body) return;
    ball.held = false;
    body.setGravityScale(1);
    this.setBounce(body, params.restitution);
    body.setAwake(true);
  }

  /** How bouncy a ball is, including in the contacts it already has, which would otherwise keep the old value. */
  private setBounce(body: Body, restitution: number): void {
    body.getFixtureList()!.setRestitution(restitution);
    for (let edge = body.getContactList(); edge; edge = edge.next) edge.contact.resetRestitution();
  }

  /** Advance the world by one `STEP`. Returns the ids of balls that left for good. */
  step(): number[] {
    const dt = STEP;
    const radius = params.ballDiameter / 2;
    this.meetings.length = 0;

    for (const ball of this.balls) {
      const body = this.bodies.get(ball.id)!;
      ball.prevX = ball.x;
      ball.prevY = ball.y;
      ball.prevAngle = ball.angle;

      if (ball.held) {
        // The carried ball chases the pointer rather than teleporting, so it still pushes and
        // collides. It has a top speed, which is what gives it weight in the hand.
        const p = body.getPosition();
        let vx = (this.target.x * U - p.x) * params.followRate;
        let vy = (this.target.y * U - p.y) * params.followRate;
        const speed = Math.hypot(vx, vy) / U;
        if (speed > params.carrySpeed) {
          vx *= params.carrySpeed / speed;
          vy *= params.carrySpeed / speed;
        }
        body.setLinearVelocity({ x: vx, y: vy });
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
    this.time += dt;
    this.pickImpacts();

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

  /**
   * A ball and something else have just come into contact. The engine calls this before it resolves the
   * contact, when the bodies still carry the speed they arrived with; afterwards a bounce has already
   * turned it around. The speed that counts is the part of their closing speed along the line between them.
   */
  private noteMeeting(contact: Contact): void {
    const bodyA = contact.getFixtureA().getBody();
    const bodyB = contact.getFixtureB().getBody();
    const balls = [bodyA, bodyB].map((body) => body.getUserData()).filter((id): id is number => typeof id === "number");
    const manifold = contact.getWorldManifold(null);
    if (balls.length === 0 || !manifold) return;
    const a = bodyA.getLinearVelocity();
    const b = bodyB.getLinearVelocity();
    // The normal points from A to B, so they are closing when B moves against it.
    const speed = -((b.x - a.x) * manifold.normal.x + (b.y - a.y) * manifold.normal.y) / U;
    if (speed > 0) this.meetings.push({ balls, speed });
  }

  /**
   * Turn the contacts that began during the step into `impacts`, the strongest first. A meeting counts if
   * any ball in it has been free of new contacts for `QUIET`, or if it is much harder (`HARDER`) than what
   * counted since: two balls meeting count if either qualifies, since a ball that has just bounced off the
   * floor still strikes a ball that has been sitting there. Every ball in a meeting has met something from
   * then on, whether or not that counted, which is also what makes a ball that meets two things at once
   * count once (the strongest first, so it is the strongest that counts).
   */
  private pickImpacts(): void {
    this.impacts.length = 0;
    for (const meeting of this.meetings.sort((p, q) => q.speed - p.speed)) {
      const runs = meeting.balls.map((id) => {
        const met = this.lastMet.get(id);
        return met && this.time - met.at <= QUIET ? met : undefined; // the ball's recent meetings, if it has had any
      });
      const counts = runs.some((run) => !run || meeting.speed > run.hardest * HARDER);
      meeting.balls.forEach((id, i) => {
        const hardest = counts ? Math.max(runs[i]?.hardest ?? 0, meeting.speed) : runs[i]!.hardest;
        this.lastMet.set(id, { at: this.time, hardest });
      });
      if (counts) this.impacts.push({ speed: meeting.speed });
    }
  }

  private unpin(ball: Ball, body: Body): void {
    if (!ball.pinned) return;
    ball.pinned = false;
    body.setGravityScale(1);
    body.setAwake(true);
  }

  /** Take a ball off the court. */
  remove(id: number): void {
    const body = this.bodies.get(id);
    if (body) this.world.destroyBody(body);
    this.bodies.delete(id);
    this.lastMet.delete(id);
    const index = this.balls.findIndex((b) => b.id === id);
    if (index >= 0) this.balls.splice(index, 1);
    if (this.heldId === id) this.heldId = null;
  }
}
