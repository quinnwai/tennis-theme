import { Box, Chain, Circle, Edge, MouseJoint, Polygon, Settings, World, type Body, type Contact, type Fixture } from "planck";
import { CAN_BALLS, CAN_BOTTOM_HEAVY, CAN_HEIGHT, CAN_WIDTH, isTipped, mouthDirection } from "./cans";
import type { Point } from "./geometry";
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

/** Past this many balls on the court, the oldest loose one makes way for each new one (see `Court.makeRoom`). */
export const MAX_BALLS = 60;

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

/**
 * A can of balls as the rest of the app sees it, in the same units as a ball. Its position is the middle of its body, and its angle
 * is counter-clockwise from upright, so that 0 has the mouth straight up. The balls inside are not balls yet: they are a count, and
 * each becomes a real ball at the can's mouth when the can is tipped (see `Court.step`). So a can that is upright, however it is
 * carried or thrown, keeps them.
 */
export interface Can {
  readonly id: number;
  /** Which of the three cans it is: it picks how its balls are turned in its picture. */
  readonly seed: number;
  x: number;
  y: number;
  angle: number;
  /** Where the can was one step ago, for smooth drawing between steps. */
  prevX: number;
  prevY: number;
  prevAngle: number;
  vx: number;
  vy: number;
  /** The balls still inside. */
  ballsLeft: number;
  /** Being carried by the pointer. */
  held: boolean;
}

/** What a can is made of. A real can is a light tin; this one is as heavy as a few balls, which keeps it from being batted about. */
const CAN_DENSITY = 1;
const CAN_FRICTION = 0.4;
const CAN_RESTITUTION = 0.1; // a can lands with a thud
/** The turning of a can slows by itself, a little, as anything does in the air. */
const CAN_ANGULAR_DAMPING = 1;
/**
 * How a can is held. It hangs from the point it was taken by, on a spring that pulls that point to the pointer (so it is carried,
 * and thrown by what it was doing when let go), as stiff as a carried ball (`followRate`) and as hard to pull off as 800 times
 * its own weight. The hand also keeps it upright, with a torque that grows with the tilt and is at most `params.canGrip`:
 * a gentle carry never tips it, a hard shake does. The two numbers below turn `canGrip` into that stiffness and a damping against
 * the can's spin; they came from trying a can on the paths of a drag, a flick, a shake and a sway.
 */
const CAN_HOLD_HZ = 8;
const CAN_HOLD_FORCE = 800;
const GRIP_STIFFNESS = 1.7;
const GRIP_DAMPING = 0.07;
/** A ball is let out this far clear of the can's mouth, so that it does not start inside the can. */
const MOUTH_CLEARANCE = 0.004;
/** A can this far past the side lines is out, as a ball is. */
const CAN_OUT = 0.15;

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
 * with the letters of the name standing in it as solid shapes, and the bench and bag too.
 */
export class Court {
  readonly balls: Ball[] = [];
  /** The cans that are out of the bag. */
  readonly cans: Can[] = [];
  /** The bag's outline, which a can being lifted out of the bag passes through until it is clear (see `setBag`). */
  private bagFixtures = new Set<Fixture>();
  private bagLoops: Point[][] = [];
  private emerging = new Set<Body>();
  /** What stands in the open bag, which comes and goes while the toy runs (see `setSolids`). */
  private changing: Body | null = null;
  /** Whether a poured ball may appear at a point (meters): the toy says no inside a letter, the bench or the bag. */
  canPourAt: (at: Point) => boolean = () => true;
  /**
   * What the latest `step()` struck, one entry for each time a ball met something new, strongest first.
   * A ball that rests on something or rolls along it meets nothing new, so it adds nothing; a ball that
   * touches two things in the same instant, such as the corner of a letter, counts once; and a ball that
   * keeps meeting something again and again (see `QUIET` and `HARDER`) counts only the first time, and
   * again for anything much harder.
   */
  readonly impacts: Impact[] = [];
  private world: World;
  /** The body that everything fixed belongs to: the walls, the letters, the buttons, the bench and the bag. */
  private fixed: Body;
  /** How far above the bottom of the window the floor is, in meters. */
  private floor: number;
  private bodies = new Map<number, Body>();
  private canBodies = new Map<number, Body>();
  /** For each can, how long it has been tipped since its last ball left. */
  private pourClock = new Map<number, number>();
  /** Balls and cans share one run of numbers, so that an id says which one it is. */
  private nextId = 1;
  private heldId: number | null = null;
  private heldCan: Can | null = null;
  /** What carries the held can: a spring from the point it was taken by to the pointer. */
  private hold: MouseJoint | null = null;
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
   * `solids` are solid shapes, each a convex outline, such as the bench.
   */
  constructor(
    private width: number,
    height: number,
    letters: { x: number; y: number }[][] = [],
    pegs: { x: number; y: number; radius: number }[] = [],
    floor = 0,
    solids: Point[][] = [],
  ) {
    Settings.velocityThreshold = deadBounceSpeed() * U;
    this.floor = floor;
    this.world = new World({ gravity: { x: 0, y: -params.gravity * U } });
    const walls = (this.fixed = this.world.createBody());
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
    for (const solid of solids) this.addSolid(solid);
    this.world.on("begin-contact", (contact) => this.noteMeeting(contact));
    // A can lifted out of the bag starts inside the bag's outline, and passes through it until it is clear.
    this.world.on("pre-solve", (contact) => {
      const a = contact.getFixtureA();
      const b = contact.getFixtureB();
      if ((this.bagFixtures.has(a) && this.emerging.has(b.getBody())) || (this.bagFixtures.has(b) && this.emerging.has(a.getBody()))) {
        contact.setEnabled(false);
      }
    });
  }

  /** The bag's outline, closed loops in meters. Balls bounce off it; a can being lifted out of it does not. */
  setBag(loops: Point[][]): void {
    this.bagLoops = loops;
    const body = this.world.createBody();
    for (const loop of loops) {
      const points = loop.map((p) => ({ x: p.x * U, y: p.y * U }));
      this.bagFixtures.add(body.createFixture(new Chain(points, true), { friction: params.friction })!);
    }
  }

  /**
   * Solid shapes that come and go while the toy runs, such as what stands in the open bag: closed loops in meters. Each call
   * replaces the last set.
   */
  setSolids(loops: Point[][]): void {
    if (this.changing) this.world.destroyBody(this.changing);
    this.changing = this.world.createBody();
    for (const loop of loops) {
      const points = loop.map((p) => ({ x: p.x * U, y: p.y * U }));
      this.changing.createFixture(new Chain(points, true), { friction: params.friction });
    }
    // Balls resting where a shape came or went should notice.
    for (const body of this.bodies.values()) body.setAwake(true);
  }

  /** Whether a can is still on its way out of the bag. */
  isEmerging(id: number): boolean {
    const body = this.canBodies.get(id);
    return !!body && this.emerging.has(body);
  }

  /** Whether any corner of a can is inside the bag's outline. */
  private inBag(can: Can): boolean {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const lx = (sx * CAN_WIDTH) / 2;
      const ly = (sy * CAN_HEIGHT) / 2;
      return { x: can.x + lx * Math.cos(can.angle) - ly * Math.sin(can.angle), y: can.y + lx * Math.sin(can.angle) + ly * Math.cos(can.angle) };
    });
    return corners.some((p) =>
      this.bagLoops.some((loop) => {
        let inside = false;
        for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
          if (loop[i].y > p.y !== loop[j].y > p.y && p.x < ((loop[j].x - loop[i].x) * (p.y - loop[i].y)) / (loop[j].y - loop[i].y) + loop[i].x) inside = !inside;
        }
        return inside;
      }),
    );
  }

  /** The can under a point (meters), if any, a little generously. */
  canAt(at: Point): Can | null {
    for (let i = this.cans.length - 1; i >= 0; i--) {
      const c = this.cans[i];
      const dx = at.x - c.x;
      const dy = at.y - c.y;
      const lx = dx * Math.cos(-c.angle) - dy * Math.sin(-c.angle);
      const ly = dx * Math.sin(-c.angle) + dy * Math.cos(-c.angle);
      if (Math.abs(lx) <= CAN_WIDTH / 2 + 0.01 && Math.abs(ly) <= CAN_HEIGHT / 2 + 0.01) return c;
    }
    return null;
  }

  /** A solid shape that stays where it is: a convex outline in meters. Returns it, to take away again with `removeSolid`. */
  addSolid(outline: Point[]): Fixture {
    const points = outline.map((p) => ({ x: p.x * U, y: p.y * U }));
    return this.fixed.createFixture(new Polygon(points), { friction: params.friction })!;
  }

  removeSolid(solid: Fixture): void {
    this.fixed.destroyFixture(solid);
  }

  /** A ball at (x, y), at rest unless given a velocity in m/s. */
  addBall(x: number, y: number, pinned: boolean, vx = 0, vy = 0): Ball {
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
    if (vx !== 0 || vy !== 0) body.setLinearVelocity({ x: vx * U, y: vy * U });
    const ball: Ball = {
      id,
      x,
      y,
      angle: 0,
      prevX: x,
      prevY: y,
      prevAngle: 0,
      vx,
      vy,
      pinned,
      held: false,
    };
    this.balls.push(ball);
    this.bodies.set(ball.id, body);
    return ball;
  }

  /** Make room for one more ball: when the court is full (`MAX_BALLS`), the oldest loose ball goes. Balls in cans are not on the court, so never go. */
  makeRoom(): void {
    if (this.balls.length < MAX_BALLS) return;
    const oldest = this.balls.find((b) => !b.pinned && !b.held);
    if (oldest) this.remove(oldest.id);
  }

  /** A can standing out of the bag, with its middle at (x, y), `angle` radians counter-clockwise from upright and `balls` in it. */
  addCan(x: number, y: number, angle = 0, balls = CAN_BALLS, seed = 0, fromBag = false): Can {
    const id = this.nextId++;
    const body = this.world.createBody({
      type: "dynamic",
      position: { x: x * U, y: y * U },
      angle,
      angularDamping: CAN_ANGULAR_DAMPING,
      userData: id, // a can that lands is an impact, like a ball
    });
    body.createFixture(new Box((CAN_WIDTH / 2) * U, (CAN_HEIGHT / 2) * U), {
      density: CAN_DENSITY,
      friction: CAN_FRICTION,
      restitution: CAN_RESTITUTION,
    });
    // Its weight is low in it, from the balls: the same mass and turning, about a point below the middle.
    const mass = body.getMass();
    const middle = { x: 0, y: -CAN_BOTTOM_HEAVY * (CAN_HEIGHT / 2) * U };
    body.setMassData({ mass, center: middle, I: body.getInertia() + mass * middle.y * middle.y });
    if (fromBag) this.emerging.add(body);
    const can: Can = { id, seed, x, y, angle, prevX: x, prevY: y, prevAngle: angle, vx: 0, vy: 0, ballsLeft: balls, held: false };
    this.cans.push(can);
    this.canBodies.set(id, body);
    return can;
  }

  /** Take a can off the court. */
  removeCan(id: number): void {
    if (this.heldCan?.id === id) this.letGoOfCan();
    const body = this.canBodies.get(id);
    if (body) this.world.destroyBody(body);
    this.emerging.delete(body ?? ({} as Body));
    this.canBodies.delete(id);
    this.pourClock.delete(id);
    this.lastMet.delete(id);
    const index = this.cans.findIndex((c) => c.id === id);
    if (index >= 0) this.cans.splice(index, 1);
  }

  /** Take every can off the court. */
  clearCans(): void {
    for (const can of [...this.cans]) this.removeCan(can.id);
  }

  /** Send a ball or a can flying along a unit direction, as if struck. */
  hit(id: number, dirX: number, dirY: number): void {
    const can = this.cans.find((c) => c.id === id);
    const canBody = this.canBodies.get(id);
    if (can && canBody) {
      if (can.held) return;
      const v = canBody.getLinearVelocity();
      canBody.setLinearVelocity({
        x: dirX * params.hitSpeed * U + v.x * params.hitCarryOver,
        y: dirY * params.hitSpeed * U + v.y * params.hitCarryOver,
      });
      canBody.setAwake(true);
      return;
    }
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

  /**
   * Pick a ball or a can up. It follows `carryTo` until `release`. A ball is carried by its middle, but a can hangs from the point
   * `at` (in meters) where it was taken, so that is the one thing a can needs to be told.
   */
  grab(id: number, at?: Point): void {
    const can = this.cans.find((c) => c.id === id);
    if (can) {
      this.grabCan(can, at ?? can);
      return;
    }
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

  /** Hang a can from the point of it nearest `at`, on a spring to the pointer. */
  private grabCan(can: Can, at: Point): void {
    const body = this.canBodies.get(can.id)!;
    if (this.heldCan) return;
    const local = body.getLocalPoint({ x: at.x * U, y: at.y * U });
    local.x = Math.min((CAN_WIDTH / 2) * U, Math.max((-CAN_WIDTH / 2) * U, local.x));
    local.y = Math.min((CAN_HEIGHT / 2) * U, Math.max((-CAN_HEIGHT / 2) * U, local.y));
    this.hold = this.world.createJoint(
      new MouseJoint(
        { maxForce: CAN_HOLD_FORCE * body.getMass(), frequencyHz: CAN_HOLD_HZ, dampingRatio: 1 },
        this.fixed,
        body,
        body.getWorldPoint(local),
      ),
    ) as MouseJoint;
    this.heldCan = can;
    can.held = true;
    this.target = { x: at.x, y: at.y };
    body.setAwake(true);
  }

  private letGoOfCan(): void {
    if (this.hold) this.world.destroyJoint(this.hold);
    this.hold = null;
    if (this.heldCan) this.heldCan.held = false;
    this.heldCan = null;
  }

  /** Let go of the carried ball or can. It keeps the speed it had, which is how a throw happens. */
  release(): void {
    if (this.heldCan) this.letGoOfCan();
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

    for (const can of this.cans) {
      can.prevX = can.x;
      can.prevY = can.y;
      can.prevAngle = can.angle;
    }
    if (this.heldCan && this.hold) this.keepHolding(this.canBodies.get(this.heldCan.id)!, this.hold);

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

    for (const can of this.cans) {
      const body = this.canBodies.get(can.id)!;
      if (can.held) this.capSpeed(body);
      const p = body.getPosition();
      const v = body.getLinearVelocity();
      can.x = p.x / U;
      can.y = p.y / U;
      can.angle = body.getAngle();
      can.vx = v.x / U;
      can.vy = v.y / U;
      if (this.emerging.has(body) && !this.inBag(can)) this.emerging.delete(body);
    }
    this.pourTippedCans();
    for (const can of [...this.cans]) {
      if (can.x < -CAN_OUT || can.x > this.width + CAN_OUT) {
        this.removeCan(can.id);
        gone.push(can.id);
      }
    }
    return gone;
  }

  /**
   * One step of carrying a can: the spring's far end goes where the pointer is, and the hand pushes the can back toward upright, as
   * hard as `canGrip` allows and no harder.
   */
  private keepHolding(body: Body, hold: MouseJoint): void {
    hold.setTarget({ x: this.target.x * U, y: this.target.y * U });
    const turned = Math.atan2(Math.sin(body.getAngle()), Math.cos(body.getAngle()));
    const grip = params.canGrip;
    const torque = -GRIP_STIFFNESS * grip * turned - GRIP_DAMPING * grip * body.getAngularVelocity();
    body.applyTorque(Math.min(grip, Math.max(-grip, torque)), true);
  }

  /** A carried can goes no faster than a carried ball does, which is what limits a throw. */
  private capSpeed(body: Body): void {
    const v = body.getLinearVelocity();
    const speed = Math.hypot(v.x, v.y) / U;
    if (speed > params.carrySpeed) body.setLinearVelocity({ x: (v.x * params.carrySpeed) / speed, y: (v.y * params.carrySpeed) / speed });
  }

  /**
   * Let balls out of every can that is tipped. A tipped can lets one out each `canPourInterval`, from its mouth along the way the mouth
   * points, moving as the mouth is moving; an upright can lets out none. A ball that would start inside something waits, so that a can
   * turned mouth down on the floor or the seat stays full until it is lifted. Each ball counts toward `MAX_BALLS` like any other.
   */
  private pourTippedCans(): void {
    const radius = params.ballDiameter / 2;
    for (const can of this.cans) {
      if (can.ballsLeft <= 0 || !isTipped(can.angle, params.canPourAngle)) {
        this.pourClock.set(can.id, 0);
        continue;
      }
      const clock = (this.pourClock.get(can.id) ?? 0) + STEP;
      this.pourClock.set(can.id, clock);
      if (clock < params.canPourInterval) continue;
      const mouth = mouthDirection(can.angle);
      const reach = CAN_HEIGHT / 2 + radius + MOUTH_CLEARANCE;
      const at = { x: can.x + mouth.x * reach, y: can.y + mouth.y * reach };
      if (!this.roomFor(at, radius) || !this.canPourAt(at)) continue;
      const v = this.canBodies.get(can.id)!.getLinearVelocityFromWorldPoint({ x: at.x * U, y: at.y * U });
      this.makeRoom();
      this.addBall(at.x, at.y, false, v.x / U + mouth.x * params.canPourSpeed, v.y / U + mouth.y * params.canPourSpeed);
      can.ballsLeft--;
      this.pourClock.set(can.id, 0);
    }
  }

  /** Whether a ball of `radius` could be put at `at` without starting inside the floor, a wall or anything solid, or another ball. */
  private roomFor(at: Point, radius: number): boolean {
    if (at.x - radius < 0 || at.x + radius > this.width || at.y - radius < this.floor) return false;
    const spot = (dx: number, dy: number) => ({ x: (at.x + dx) * U, y: (at.y + dy) * U });
    const reach = radius * 0.8;
    const samples = [spot(0, 0), spot(reach, 0), spot(-reach, 0), spot(0, reach), spot(0, -reach)];
    let free = true;
    this.world.queryAABB(
      { lowerBound: spot(-radius, -radius), upperBound: spot(radius, radius) },
      (fixture) => {
        if (samples.some((s) => fixture.testPoint(s))) free = false;
        return free;
      },
    );
    return free;
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
