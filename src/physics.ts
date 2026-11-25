import { Box, Chain, Circle, Edge, Polygon, Settings, World, type Body, type Contact, type Fixture } from "planck";
import { CAN_BALLS, CAN_HEIGHT, CAN_WIDTH } from "./cans";
import type { Point } from "./geometry";
import { params } from "./params";
import {
  FRAME,
  canSolid,
  clearSpot,
  makeSolid,
  newBody,
  overlapsSolids,
  settleConstants,
  settleFrame,
  type Disc,
  type Pose,
  type SettleBody,
  type SettleConstants,
  type SettleWorld,
  type Solid,
} from "./settle";

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
export const MAX_BALLS = 20;

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
  /** Where it was last thrown or hit from (meters), or null if it was let go slowly, poured or new: it never scores. */
  shot: { x: number; y: number } | null;
  /** Whether a hand has carried or hit it since it appeared. */
  handled: boolean;
  /** Which can it was poured from (by its seed), if it was, and when (the court's seconds): for a moment it does not go straight back into it. */
  pouredFrom: number | null;
  pouredAt: number;
}

/** Why a ball that went into a can did or did not win a point (QWW-99, "A point"). */
export type Entry = "point" | "dropped" | "too close";

/** An opening balls go into: its middle (meters), the way out of it (a unit vector), and its half width. */
interface Mouth {
  x: number;
  y: number;
  ux: number;
  uy: number;
  half: number;
}

function canMouth(can: Can): Mouth {
  const ux = -Math.sin(can.angle);
  const uy = Math.cos(can.angle);
  const h = CAN_HEIGHT * can.scale;
  return { x: can.x + (ux * h) / 2, y: can.y + (uy * h) / 2, ux, uy, half: (CAN_WIDTH * can.scale) / 2 };
}

/**
 * Whether a ball of radius `r` at `at`, moving at `vel`, comes down into `mouth` (itself moving at `mv`) within the next step:
 * heading in, over the opening, and about to reach the height where it would touch the rim.
 */
function comingIn(at: Point, vel: Point, mouth: Mouth, mv: Point, r: number): boolean {
  const dx = at.x - mouth.x;
  const dy = at.y - mouth.y;
  const up = dx * mouth.ux + dy * mouth.uy;
  const across = dx * mouth.uy - dy * mouth.ux;
  const vUp = (vel.x - mv.x) * mouth.ux + (vel.y - mv.y) * mouth.uy;
  const vAcross = (vel.x - mv.x) * mouth.uy - (vel.y - mv.y) * mouth.ux;
  if (vUp >= 0 || up < -0.25 * r) return false;
  return up + vUp * STEP <= r * 1.02 && Math.abs(across + vAcross * STEP) <= mouth.half;
}

/** Whether a ball of radius `r` has come to rest on `mouth` (an open lid), over its opening. */
function restingIn(at: Point, vel: Point, mouth: Mouth, r: number): boolean {
  if (Math.hypot(vel.x, vel.y) > 0.1) return false;
  const dx = at.x - mouth.x;
  const dy = at.y - mouth.y;
  const up = dx * mouth.ux + dy * mouth.uy;
  const across = dx * mouth.uy - dy * mouth.ux;
  return up > 0.6 * r && up < 1.3 * r && Math.abs(across) <= mouth.half;
}

/** The id the trophy goes by once it has been touched and is a thing in the court, carried and set down like a can. */
export const TROPHY_ID = -1;

/** How long a poured ball keeps out of the can it came from, seconds, unless a hand touches it. */
const POURED_AWAY = 1.5;

/**
 * A can of balls as the rest of the app sees it, in the same units as a ball. Its position is the middle of its body, and its angle
 * is counter-clockwise from upright, so that 0 has the mouth straight up. The balls inside are not balls: they are a count, and
 * each becomes a real ball at the can's mouth when the can is tapped and pours (see `Court.tapCan`).
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
  /** Its size as a share of real size: 1, except a can lifted out of the bag drawn smaller (a phone held sideways) to pour, which keeps the bag's size. */
  scale: number;
}

/**
 * What a can is doing, from Quinn-Wai's controls spec. `placed`: standing still where it came to rest, fixed. `held`: carried.
 * `settling`: falling after it was let go (or put down). `pour` and `wiggle`: tapped.
 */
export type CanState = "placed" | "held" | "settling" | "pour" | "wiggle";

/** A tapped can tipping its balls out. Times in seconds; `dir` 1 pours to the right, -1 to the left. */
interface Pour {
  t: number;
  phase: "up" | "drop" | "down";
  dir: number;
  x0: number;
  y0: number;
  a0: number;
  lift: number;
  next: number;
  /** Balls still to come out; one that has nowhere to go stays in. */
  tries: number;
}

/**
 * How a can moves. It is moved in can frames, 60 a second as in the spec, and in between it travels straight from where the last
 * frame left it (`from`) to where the next one puts it (`to`), so the balls it meets on the way are pushed by it at the speed it
 * really moves.
 */
interface Drive {
  state: CanState;
  from: Pose;
  to: Pose;
  /** Carried: the spring's speed, per can frame, where the hand wants its middle, and where it was pressed from it. */
  vx: number;
  vy: number;
  av: number;
  target: Point;
  offset: Point;
  body: SettleBody | null;
  pour: Pour | null;
  wiggle: { left: number; a0: number } | null;
  /** Lifted out of the open bag to pour or wiggle: it goes back in when it is done. */
  back: boolean;
  /** The settle, pour or wiggle has ended: at the next can frame it stands where it is. */
  done: boolean;
  /** Carried: what the let go would start from (where it was, how it moved, the balls as they were), and can frames since. */
  preview: { pose: Pose; vx: number; vy: number; w: number; discs: Disc[] } | null;
  previewAge: number;
  /** Carried: where a let go from `preview` ends up, the drop preview. */
  rest: Pose | null;
  /** Settling: the balls as they were when it was let go, which it lands on (as the spec says, they hold still for it). */
  discs: Disc[] | null;
  /** Standing on the trophy: where the trophy was then (meters). If the trophy moves, the can checks it still stands. */
  onTrophy: Point | null;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clampTo = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** The spec's pour, in seconds and radians: up, a ball every so often, a wait, back down. */
const POUR_UP = 0.3;
const POUR_TIP = 2.6; // about 149 degrees: the mouth points down and a little sideways
const POUR_GAP = 0.22;
const POUR_WAIT = 0.12;
const WIGGLE = 0.45;
/** The most a carried can leans into a sideways move, radians: about 17 degrees. */
const MAX_LEAN = 0.3;
/** The most the heavy trophy leans in the hand, radians: about 2.9 degrees. */
const TROPHY_LEAN = 0.05;
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
  /** The bench's, whose ends are dead: a ball that meets one comes back off it at `params.benchEndRestitution`. */
  private benchFixtures = new Set<Fixture>();
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
  /** The `seed` of each can that left past the side lines during the last step, for the page to put back in the bag. */
  readonly cansGone: number[] = [];
  private world: World;
  /** The body that everything fixed belongs to: the walls, the letters, the buttons, the bench and the bag. */
  private fixed: Body;
  /** How far above the bottom of the window the floor is, in meters. */
  private floor: number;
  private bodies = new Map<number, Body>();
  private canBodies = new Map<number, Body>();
  /** Balls and cans share one run of numbers, so that an id says which one it is. */
  private nextId = 1;
  private heldId: number | null = null;
  private height: number;
  private letterLoops: Point[][];
  private pegDiscs: Disc[];
  private benchLoops: Point[][] = [];
  private solidLoops: Point[][] = [];
  private drives = new Map<number, Drive>();
  /** The bodies of the cans falling after being let go: balls pass through them (see the pre-solve handler). */
  private settling = new Set<Body>();
  /** The balls each standing can holds in place with it (the ones it leans on), by the can's id. */
  private props = new Map<number, number[]>();
  /** Something that may have been holding a standing can up has gone (a ball taken away, a can moved, the bag zipped shut): each standing can checks it still stands, and falls if not (see `recheck`). */
  private supportChanged = false;
  /** Physics steps into the current can frame (four to a frame). */
  private sub = 0;
  private staticSolids: Solid[] | null = null;
  private settleK: SettleConstants | null = null;
  /** The trophy: its body (kinematic while it floats, moved by `moveTrophy`) and its mouth, from the body's origin. */
  private trophy: { body: Body; mouth: { x: number; y: number; half: number } } | null = null;
  private trophyOutline: Point[] = [];
  private trophyBox: { cx: number; cy: number; hw: number; hh: number } | null = null;
  /** Once it has been touched, the trophy as a can-like thing: carried, let go, standing still (see `freeTrophy`). */
  private trophyCan: Can | null = null;
  private trophyFixture: Fixture | null = null;
  /** A can lifted out of the open bag to pour or wiggle is done and stands back in its place: the toy puts it back. */
  onBackInBag: (can: Can) => void = () => {};
  /** The cans standing in the open bag, which take balls too once they have room: which can, how many more it holds, and its mouth. Set by the toy. */
  bagMouths: { seed: number; room: number; mouth: Mouth }[] = [];
  /** A ball went into a can: `entry` says whether it won a point, and if not, why not. The ball has left the court. */
  onCanEntry: (can: Can, ball: Ball, entry: Entry) => void = () => {};
  /** A ball went into the trophy, which keeps it: it has left the court. It scores like one into a can, by `entry`. */
  onTrophyEntry: (ball: Ball, entry: Entry) => void = () => {};
  /** A ball went into a can standing in the open bag. */
  onBagEntry: (seed: number, ball: Ball, entry: Entry) => void = () => {};
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
    this.height = height;
    this.letterLoops = letters;
    this.pegDiscs = pegs.map((p) => ({ x: p.x, y: p.y, r: p.radius }));
    this.benchLoops = solids;
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
    for (const solid of solids) this.benchFixtures.add(this.addSolid(solid));
    this.world.on("begin-contact", (contact) => this.noteMeeting(contact));
    // A can lifted out of the bag starts inside the bag's outline, and passes through it until it is clear.
    this.world.on("pre-solve", (contact) => {
      const a = contact.getFixtureA();
      const b = contact.getFixtureB();
      // (what stands in the open bag, the other cans' lids and the notebook, is part of it: a can drawn smaller than real, on a short window,
      // would otherwise be pushed out violently by the lids of the cans beside it, which are nearer than its real width)
      const ofBag = (fixture: Fixture) => this.bagFixtures.has(fixture) || (this.changing !== null && fixture.getBody() === this.changing);
      if ((ofBag(a) && this.emerging.has(b.getBody())) || (ofBag(b) && this.emerging.has(a.getBody()))) {
        contact.setEnabled(false);
      }
      // A falling can rests on the balls as they were and doesn't push them (they pass through it until it stands still), as in the
      // spec's prototype, so that it lands exactly where it was going to.
      if (this.settling.has(a.getBody()) || this.settling.has(b.getBody())) contact.setEnabled(false);
      // A can in the hand passes through everything (QWW-99, "Carry a can"): it never moves a ball, or pushes one through the floor.
      if (this.carried(a.getBody()) || this.carried(b.getBody())) contact.setEnabled(false);
      // The bench's ends are dead next to its seat, and so are the trophy's sides. A contact that pushes mostly sideways is an end: the
      // ball comes back off it at benchEndRestitution, however hard it was pushed or thrown in. The seat keeps the usual bounce.
      const trophySide = this.trophyFixture !== null && (a === this.trophyFixture || b === this.trophyFixture);
      if (this.benchFixtures.has(a) || this.benchFixtures.has(b) || trophySide) {
        const normal = contact.getWorldManifold(null)?.normal;
        if (normal && Math.abs(normal.x) > 0.7) contact.setRestitution(params.benchEndRestitution);
        else contact.resetRestitution();
      }
    });
  }

  /** The bag's outline, closed loops in meters. Balls bounce off it; a can being lifted out of it does not. */
  setBag(loops: Point[][]): void {
    this.bagLoops = loops;
    this.staticSolids = null;
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
    this.solidLoops = loops;
    this.staticSolids = null;
    this.supportChanged = true;
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

  /** The can under a point (meters), if any, or within `margin` of it. The one drawn last (on top) wins. */
  canAt(at: Point, margin = 0.01): Can | null {
    for (let i = this.cans.length - 1; i >= 0; i--) {
      const c = this.cans[i];
      const dx = at.x - c.x;
      const dy = at.y - c.y;
      const lx = dx * Math.cos(-c.angle) - dy * Math.sin(-c.angle);
      const ly = dx * Math.sin(-c.angle) + dy * Math.cos(-c.angle);
      if (Math.abs(lx) <= (CAN_WIDTH * c.scale) / 2 + margin && Math.abs(ly) <= (CAN_HEIGHT * c.scale) / 2 + margin) return c;
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
      shot: null,
      handled: false,
      pouredFrom: null,
      pouredAt: 0,
    };
    this.balls.push(ball);
    this.bodies.set(ball.id, body);
    return ball;
  }

  /** Make room for one more ball: when the court is full (`MAX_BALLS`), the oldest loose ball goes, one that holds a can up last. Balls in cans are not on the court, so never go. */
  makeRoom(): void {
    if (this.balls.length < MAX_BALLS) return;
    const loose = (b: Ball) => !b.pinned && !b.held;
    const oldest = this.balls.find((b) => loose(b) && !this.isPropping(b.id)) ?? this.balls.find(loose);
    if (oldest) this.remove(oldest.id);
  }

  /**
   * A can with its middle at (x, y), `angle` radians counter-clockwise from upright and `balls` in it. It starts falling from where it
   * is (`state` "settling") unless it is `placed` to stand there. `fromBag`: it is lifted out of the bag, so it passes through the bag's
   * outline until it is clear of it. `scale`: its size as a share of real size.
   */
  addCan(x: number, y: number, angle = 0, balls = CAN_BALLS, seed = 0, fromBag = false, opts: { scale?: number; state?: "settling" | "placed" } = {}): Can {
    const id = this.nextId++;
    const state = opts.state ?? "settling";
    const scale = opts.scale ?? 1;
    // A can is never pushed around by the balls. It is moved by the hand, its own settle or a pour (kinematic), or stands where it came
    // to rest (static).
    const body = this.world.createBody({
      type: state === "placed" ? "static" : "kinematic",
      position: { x: x * U, y: y * U },
      angle,
      // (no userData: a can that lands makes no sound. A ball that meets a can still counts, through the ball's own.)
    });
    body.createFixture(new Box(((CAN_WIDTH * scale) / 2) * U, ((CAN_HEIGHT * scale) / 2) * U), {
      density: 1,
      friction: params.friction,
      restitution: 0.1, // a ball bounces off a can with a thud
    });
    if (fromBag) this.emerging.add(body);
    const can: Can = { id, seed, x, y, angle, prevX: x, prevY: y, prevAngle: angle, vx: 0, vy: 0, ballsLeft: balls, held: false, scale };
    this.cans.push(can);
    this.canBodies.set(id, body);
    const pose = { x, y, a: angle };
    const drive: Drive = {
      state,
      from: pose,
      to: pose,
      vx: 0,
      vy: 0,
      av: 0,
      target: { x, y },
      offset: { x: 0, y: 0 },
      body: null,
      pour: null,
      wiggle: null,
      back: false,
      done: false,
      preview: null,
      previewAge: 0,
      rest: null,
      discs: null,
      onTrophy: null,
    };
    this.drives.set(id, drive);
    if (state === "settling") {
      const [hw, hh] = this.half(can);
      drive.discs = this.ballSnapshot();
      drive.body = newBody(clearSpot(pose, hw, hh, this.settleWorld(id, drive.discs)), 0, 0, 0, hw, hh, this.constants());
      this.settling.add(body);
    }
    return can;
  }

  /** Take a can off the court. */
  removeCan(id: number): void {
    const body = this.canBodies.get(id);
    if (body) {
      this.emerging.delete(body);
      this.settling.delete(body);
      this.world.destroyBody(body);
    }
    this.freeProps(id);
    this.canBodies.delete(id);
    this.drives.delete(id);
    this.lastMet.delete(id);
    this.supportChanged = true;
    const index = this.cans.findIndex((c) => c.id === id);
    if (index >= 0) this.cans.splice(index, 1);
  }

  /** Take every can off the court. */
  clearCans(): void {
    for (const can of [...this.cans]) this.removeCan(can.id);
  }

  /** Whether a ball is held in place by a standing can that leans on it. */
  isPropping(id: number): boolean {
    const body = this.bodies.get(id);
    return !!body && body.isStatic();
  }

  /** For browser checks: a new ball let go by a hand at (x, y) (meters, y up) at (vx, vy) m/s. Thrown from there if it is fast enough to count as a throw. */
  launch(x: number, y: number, vx: number, vy: number): Ball {
    const ball = this.addBall(x, y, false, vx, vy);
    ball.handled = true;
    ball.shot = Math.hypot(vx, vy) >= params.throwSpeed ? { x, y } : null;
    return ball;
  }

  /** Send a ball flying along a unit direction, as if struck. A can is not struck: a tap on it does nothing. */
  hit(id: number, dirX: number, dirY: number): void {
    const ball = this.balls.find((b) => b.id === id);
    const body = this.bodies.get(id);
    if (!ball || !body || ball.held) return;
    this.loosen(id);
    this.unpin(ball, body);
    ball.shot = { x: ball.x, y: ball.y };
    ball.handled = true;
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
    this.loosen(id);
    this.unpin(ball, body);
    ball.held = true;
    ball.shot = null;
    ball.handled = true;
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
    // let go while moving, it was thrown from here; let go slowly, it was only dropped
    const v = body.getLinearVelocity();
    ball.shot = Math.hypot(v.x, v.y) / U >= params.throwSpeed ? { x: ball.x, y: ball.y } : null;
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
    this.cansGone.length = 0;
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

    // Every fourth step is a can frame; each step moves the cans a quarter of the way through it.
    const back: Can[] = [];
    if (this.sub === 0) this.canFrame(back);
    this.driveCans((this.sub + 1) / 4);
    this.sub = (this.sub + 1) % 4;
    for (const can of this.movers()) {
      can.prevX = can.x;
      can.prevY = can.y;
      can.prevAngle = can.angle;
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

    for (const can of this.movers()) {
      const body = this.bodyOf(can.id)!;
      const p = body.getPosition();
      const v = body.getLinearVelocity();
      can.x = p.x / U;
      can.y = p.y / U;
      can.angle = body.getAngle();
      can.vx = v.x / U;
      can.vy = v.y / U;
      if (this.emerging.has(body) && !this.inBag(can)) this.emerging.delete(body);
    }
    for (const can of [...this.cans]) {
      if (can.x < -CAN_OUT || can.x > this.width + CAN_OUT) {
        this.removeCan(can.id);
        this.cansGone.push(can.seed);
        gone.push(can.id);
      }
    }
    this.enter();
    for (const can of back) this.onBackInBag(can);
    return gone;
  }

  /** A mouth a little wider than the can, so a ball that would clip the rim on its way in rolls in instead. */
  private wide(mouth: Mouth): Mouth {
    return { ...mouth, half: mouth.half + (params.mouthGrace * params.ballDiameter) / 2 };
  }

  /** Whether a can would take a ball: carried or standing (not falling or pouring), leaning less than `refillTilt`, with room in it. */
  private takes(can: Can): boolean {
    const tilt = Math.abs(Math.atan2(Math.sin(can.angle), Math.cos(can.angle)));
    const state = this.drives.get(can.id)?.state;
    return state !== "settling" && state !== "pour" && can.ballsLeft < CAN_BALLS && tilt <= (params.refillTilt * Math.PI) / 180;
  }

  /**
   * Balls coming down into an upright can with room go in, from any height, thrown or dropped. Each is caught the step before it
   * would touch the lid or the rim, so it never bounces off them.
   */
  private enter(): void {
    const r = params.ballDiameter / 2;
    for (const ball of [...this.balls]) {
      if (ball.held || ball.pinned) continue;
      const body = this.bodies.get(ball.id)!;
      if (!body.isDynamic()) continue; // one holding a can up stays where it is
      const at = { x: ball.x, y: ball.y };
      const vel = { x: ball.vx, y: ball.vy };
      // a ball just poured out of a can does not bounce straight back into it, unless a hand has touched it since
      const back = (seed: number) => ball.pouredFrom === seed && !ball.handled && this.time - ball.pouredAt < POURED_AWAY;
      const into = (mouth: Mouth, mv: Point) => comingIn(at, vel, this.wide(mouth), mv, r) || restingIn(at, vel, mouth, r);
      const can = this.cans.find((c) => this.takes(c) && !back(c.seed) && into(canMouth(c), { x: c.vx, y: c.vy }));
      if (can) {
        const entry = this.judge(ball, canMouth(can));
        this.remove(ball.id);
        can.ballsLeft++;
        this.onCanEntry(can, { ...ball }, entry);
        continue;
      }
      const bag = this.bagMouths.find((m) => m.room > 0 && !back(m.seed) && into(m.mouth, { x: 0, y: 0 }));
      if (bag) {
        const entry = this.judge(ball, bag.mouth);
        this.remove(ball.id);
        bag.room--;
        this.onBagEntry(bag.seed, { ...ball }, entry);
        continue;
      }
      const mouth = this.trophyMouthOf();
      if (mouth && into(mouth.mouth, mouth.v)) {
        const entry = this.judge(ball, mouth.mouth);
        this.remove(ball.id);
        this.onTrophyEntry({ ...ball }, entry);
      }
    }
  }

  /** Whether a ball going into a can wins a point: a hand threw or hit it from at least `shotDistance` of the court's width away, in a straight line in any direction. */
  private judge(ball: Ball, mouth: Mouth): Entry {
    if (!ball.shot) return "dropped";
    return Math.hypot(ball.shot.x - mouth.x, ball.shot.y - mouth.y) >= params.shotDistance * this.width ? "point" : "too close";
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
    // A can standing on the dot of an "i" may have nothing under it now.
    this.supportChanged = true;
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
    // It may have been holding a can up.
    for (const [canId, held] of this.props) if (held.includes(id)) this.props.set(canId, held.filter((b) => b !== id));
    this.supportChanged = true;
  }

  /** A ball held in place by a standing can comes loose (picked up, struck, or the can moved). */
  private loosen(id: number): void {
    const body = this.bodies.get(id);
    if (body && !body.isDynamic()) {
      body.setDynamic();
      body.setAwake(true);
      // A can it held up may have nothing under it now.
      this.supportChanged = true;
    }
  }

  /** Let go of the balls a standing can was holding in place. */
  private freeProps(canId: number): void {
    for (const id of this.props.get(canId) ?? []) this.loosen(id);
    this.props.delete(canId);
  }

  // ---- The cans' controls (Quinn-Wai's spec): carry, let go to settle, props, tap to pour ----

  /** What a can is doing, or null if there is no such can. */
  canState(id: number): CanState | null {
    return this.drives.get(id)?.state ?? null;
  }

  /**
   * Where a can belongs if the court is built again (a new window size): where it stands, or where a pour or wiggle it is in the
   * middle of started, which is cut short. Meters, angle counter-clockwise.
   */
  homeOf(id: number): Pose | null {
    const d = this.drives.get(id);
    const can = this.cans.find((c) => c.id === id);
    if (!can) return null;
    if (d?.pour) return { x: d.pour.x0, y: d.pour.y0, a: d.pour.a0 };
    if (d?.wiggle) return { ...d.to, a: d.wiggle.a0 };
    return { x: can.x, y: can.y, a: can.angle };
  }

  /** Whether a can is out of the bag only for the moment: on its way out, or lifted out to pour and going back. */
  fromBag(id: number): boolean {
    return this.isEmerging(id) || !!this.drives.get(id)?.back;
  }

  private half(can: Can): [number, number] {
    if (can.id === TROPHY_ID && this.trophyBox) return [this.trophyBox.hw, this.trophyBox.hh];
    return [(CAN_WIDTH / 2) * can.scale, (CAN_HEIGHT / 2) * can.scale];
  }

  /** The body of a can, or of the trophy once it is a thing in the court. */
  private bodyOf(id: number): Body | undefined {
    return id === TROPHY_ID ? this.trophy?.body : this.canBodies.get(id);
  }

  /** The can, or the trophy as a can-like thing. */
  private canOf(id: number): Can | undefined {
    return id === TROPHY_ID ? (this.trophyCan ?? undefined) : this.cans.find((c) => c.id === id);
  }

  /** Everything moved by can frames: the cans, and the trophy once it has been touched. */
  private movers(): Can[] {
    return this.trophyCan ? [...this.cans, this.trophyCan] : this.cans;
  }

  private constants(): SettleConstants {
    return (this.settleK ??= settleConstants(CAN_HEIGHT));
  }

  /**
   * What a settling can meets: the name, the bench, the bag and what stands in it, the cans standing still (all but `except`), and
   * `discs`, the balls and buttons, which hold still for it (see `ballSnapshot`).
   */
  private settleWorld(except: number, discs: Disc[]): SettleWorld {
    if (!this.staticSolids) {
      const groups = [this.letterLoops, ...this.benchLoops.map((l) => [l]), ...this.bagLoops.map((l) => [l]), ...this.solidLoops.map((l) => [l])];
      this.staticSolids = groups.filter((g) => g.some((l) => l.length >= 3)).map((g) => makeSolid(g));
    }
    // the cans standing still, and the spots of those pouring or wiggling, which they come back down into
    const cans = this.cans.flatMap((c) => {
      const d = this.drives.get(c.id);
      if (c.id === except || !d || d.back || !["placed", "pour", "wiggle"].includes(d.state)) return [];
      const [hw, hh] = this.half(c);
      return [canSolid(d.state === "placed" ? { x: c.x, y: c.y, a: c.angle } : this.homeOf(c.id)!, hw, hh)];
    });
    // and the trophy, once it is there, floating or standing still (not while it is carried or falling, or for itself)
    const td = this.drives.get(TROPHY_ID);
    const trophy = except === TROPHY_ID || (td && td.state !== "placed") ? null : this.trophySolid();
    return { width: this.width, height: this.height, floor: this.floor, solids: [...this.staticSolids, ...cans, ...(trophy ? [trophy] : [])], discs };
  }

  /** The trophy's outline where it is now, as a solid a can can land on. */
  private trophySolid(): Solid | null {
    const outline = this.trophyHull();
    return outline.length < 3 ? null : makeSolid([outline]);
  }

  /** The solid outline balls meet, as the court has it now: turned and placed (meters, y up). Empty if there is no trophy. */
  trophyHull(): Point[] {
    if (!this.trophy) return [];
    const p = this.trophy.body.getPosition();
    const a = this.trophy.body.getAngle();
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return this.trophyOutline.map((q) => ({ x: p.x / U + q.x * c - q.y * s, y: p.y / U + q.x * s + q.y * c }));
  }

  /** Whether a can stands on the trophy (so the toy holds the trophy still rather than bobbing it under the can). */
  trophyHolds(): boolean {
    return [...this.drives.values()].some((d) => d.state === "placed" && d.onTrophy);
  }

  /** The middle of the trophy's rim now (meters, y up) and how far it opens either side, or null if there is no trophy. */
  trophyMouth(): { x: number; y: number; half: number } | null {
    const m = this.trophyMouthOf();
    return m && { x: m.mouth.x, y: m.mouth.y, half: m.mouth.half };
  }

  /** The trophy's mouth as a ball meets it (it may stand turned), and how fast the trophy moves (m/s). */
  private trophyMouthOf(): { mouth: Mouth; v: Point } | null {
    if (!this.trophy) return null;
    const t = this.trophy.body.getPosition();
    const tv = this.trophy.body.getLinearVelocity();
    const a = this.trophy.body.getAngle();
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const m = this.trophy.mouth;
    return {
      mouth: { x: t.x / U + m.x * c - m.y * s, y: t.y / U + m.x * s + m.y * c, ux: -s, uy: c, half: m.half },
      v: { x: tv.x / U, y: tv.y / U },
    };
  }

  /** Where the trophy's anchor (the middle of its foot) is and how it is turned (meters, radians counterclockwise). */
  trophyAnchor(): Pose | null {
    if (!this.trophy) return null;
    const p = this.trophy.body.getPosition();
    return this.footOf({ x: p.x / U, y: p.y / U, a: this.trophy.body.getAngle() });
  }

  /** Where the anchor is when the trophy's box has its middle at `pose`. */
  footOf(pose: Pose): Pose {
    const [ox, oy] = this.trophyBox ? [this.trophyBox.cx, this.trophyBox.cy] : [0, 0];
    return { x: pose.x - (ox * Math.cos(pose.a) - oy * Math.sin(pose.a)), y: pose.y - (ox * Math.sin(pose.a) + oy * Math.cos(pose.a)), a: pose.a };
  }

  /**
   * Where a can let go from `inputs` will come to rest: the same settle a let go runs, ahead of time. Cans already falling are settled
   * with it a frame at a time, as the court does, so one that lands first is something this one meets, and one that lands after is not.
   */
  private landing(can: Can, inputs: NonNullable<Drive["preview"]>, hw: number, hh: number): Pose {
    const K = this.constants();
    const base = this.settleWorld(can.id, inputs.discs);
    const mine = newBody(clearSpot(inputs.pose, hw, hh, base), inputs.vx, inputs.vy, inputs.w, hw, hh, K);
    // the trophy is heavy: it stands where it lands, no lean assist
    if (can.id === TROPHY_ID) mine.lean = 0;
    if (!this.movers().some((c) => c.id !== can.id && this.drives.get(c.id)?.state === "settling")) {
      for (let i = 0; i < 800; i++) if (settleFrame(mine, base, K)) break;
      return mine;
    }
    const falling = this.movers().flatMap((c) => {
      const d = this.drives.get(c.id);
      if (c.id === can.id) return [{ id: c.id, body: mine, discs: inputs.discs, hw, hh, done: false }];
      if (!d?.body || d.state !== "settling") return [];
      const [w, h] = this.half(c);
      return [{ id: c.id, body: { ...d.body, touching: [...d.body.touching] }, discs: d.discs ?? inputs.discs, hw: w, hh: h, done: false }];
    });
    const landed: { id: number; solid: Solid }[] = [];
    const me = falling.find((f) => f.body === mine)!;
    for (let i = 0; i < 800 && !me.done; i++) {
      const finished: typeof landed = [];
      for (const f of falling) {
        if (f.done) continue;
        const world = { ...base, discs: f.discs, solids: [...base.solids, ...landed.filter((l) => l.id !== f.id).map((l) => l.solid)] };
        if (settleFrame(f.body, world, K)) {
          f.done = true;
          finished.push({ id: f.id, solid: canSolid({ x: f.body.x, y: f.body.y, a: f.body.a }, f.hw, f.hh) });
        }
      }
      landed.push(...finished);
    }
    return mine;
  }

  /**
   * Something that may have held a standing can up has gone. Each can standing still runs its settle from where it is, without
   * moving: one that stays put is left as it was; one that would fall starts falling, and lands, as if let go.
   */
  private recheck(): void {
    const K = this.constants();
    for (const can of this.movers()) {
      const d = this.drives.get(can.id);
      if (!d || d.state !== "placed" || d.back) continue;
      const [hw, hh] = this.half(can);
      const discs = this.ballSnapshot();
      const world = this.settleWorld(can.id, discs);
      const pose = { x: can.x, y: can.y, a: can.angle };
      const test = newBody(pose, 0, 0, 0, hw, hh, K);
      test.lean = 0; // it already leans the way it chose; no new nudge
      for (let i = 0; i < 24; i++) if (settleFrame(test, world, K)) break;
      const moved = Math.hypot(test.x - pose.x, test.y - pose.y) > 0.002 || Math.abs(Math.atan2(Math.sin(test.a - pose.a), Math.cos(test.a - pose.a))) > 0.02;
      if (!moved) continue;
      // it would fall: let it, from exactly where it stands. The balls it held stay held until it lands (it falls onto them as they
      // are); then those it no longer rests on come loose (see `stand`)
      const body = this.bodyOf(can.id)!;
      body.setKinematic();
      d.state = "settling";
      d.discs = discs;
      d.body = newBody(pose, 0, 0, 0, hw, hh, K);
      d.body.lean = 0;
      d.onTrophy = null;
      d.from = d.to = pose;
      this.settling.add(body);
    }
  }

  /**
   * The balls a can can land on, as they are now, and the buttons. A ball flying or rolling fast is left out: it will be somewhere
   * else by the time the can gets there (and it passes through a falling can, see the pre-solve handler).
   */
  private ballSnapshot(): Disc[] {
    const r = params.ballDiameter / 2;
    // (read from the bodies, not from the balls: a ball struck a moment ago has not been copied out of its body yet, and a can that
    // counted it as still would stay where it is, in the air)
    const still = this.balls.filter((b) => {
      if (b.held) return false;
      const v = this.bodies.get(b.id)!.getLinearVelocity();
      return Math.hypot(v.x, v.y) / U < 0.25;
    });
    return [...still.map((b) => ({ x: b.x, y: b.y, r, id: b.id })), ...this.pegDiscs];
  }

  /** One can frame: each moving can works out where it will be one frame from now. Cans that are back in the bag once done go in `back`. */
  private canFrame(back: Can[]): void {
    // a can standing on the trophy checks again once the trophy has moved from under it (carried off)
    if (this.trophy) {
      const p = this.trophy.body.getPosition();
      for (const d of this.drives.values()) {
        if (d.onTrophy && Math.hypot(d.onTrophy.x - p.x / U, d.onTrophy.y - p.y / U) > 0.001) {
          d.onTrophy = null;
          this.supportChanged = true;
        }
      }
    }
    if (this.supportChanged) {
      this.supportChanged = false;
      this.recheck();
    }
    for (const can of this.movers()) {
      const d = this.drives.get(can.id);
      if (!d) continue;
      d.from = d.to;
      if (d.done) {
        this.stand(can, d);
        if (d.back) back.push(can);
        continue;
      }
      if (d.state === "held") this.carryFrame(can, d);
      else if (d.state === "settling") {
        const done = settleFrame(d.body!, this.settleWorld(can.id, d.discs ?? this.ballSnapshot()), this.constants());
        d.to = { x: d.body!.x, y: d.body!.y, a: d.body!.a };
        if (done) d.done = true;
      } else if (d.state === "pour") this.pourFrame(can, d);
      else if (d.state === "wiggle") this.wiggleFrame(d);
    }
  }

  /** Move each moving can `f` of the way through the current can frame, by its speed, so it pushes what it meets. */
  private driveCans(f: number): void {
    for (const can of this.movers()) {
      const d = this.drives.get(can.id);
      const body = this.bodyOf(can.id);
      if (!d || !body || d.state === "placed") continue;
      const x = d.from.x + (d.to.x - d.from.x) * f;
      const y = d.from.y + (d.to.y - d.from.y) * f;
      const a = d.from.a + (d.to.a - d.from.a) * f;
      const p = body.getPosition();
      body.setLinearVelocity({ x: (x * U - p.x) / STEP, y: (y * U - p.y) / STEP });
      body.setAngularVelocity((a - body.getAngle()) / STEP);
      body.setAwake(true);
    }
  }

  /**
   * It has come to rest (or finished pouring): it stands where it is, fixed. The balls its fall ended leaning on are held in place with
   * it (a pour keeps the ones it had), so it keeps its lean however hard it is hit.
   */
  private stand(can: Can, d: Drive): void {
    const body = this.bodyOf(can.id)!;
    // it fell (rather than finished a pour or a wiggle): it rests on what its fall ended touching
    const fell = !!d.body;
    const leansOn = d.body?.touching ?? [];
    // after a tumble its turn can be whole turns round: count it from upright again, or a pour or a pick-up would spin it
    const a = Math.atan2(Math.sin(d.to.a), Math.cos(d.to.a));
    d.to = { ...d.to, a };
    d.from = d.to;
    d.state = "placed";
    d.done = false;
    d.body = null;
    d.preview = null;
    d.rest = null;
    d.discs = null;
    this.settling.delete(body);
    body.setStatic();
    body.setTransform({ x: d.to.x * U, y: d.to.y * U }, a);
    can.x = can.prevX = d.to.x;
    can.y = can.prevY = d.to.y;
    can.angle = can.prevAngle = a;
    can.vx = 0;
    can.vy = 0;
    if (d.back) return;
    // standing on the trophy? then the trophy holds still under it, and if it is carried off the can falls
    const trophy = can.id === TROPHY_ID ? null : this.trophySolid();
    const [hw, hh] = this.half(can);
    if (trophy && overlapsSolids(d.to, hw + 0.004, hh + 0.004, { width: this.width, height: this.height, solids: [trophy], discs: [] })) {
      const p = this.trophy!.body.getPosition();
      d.onTrophy = { x: p.x / U, y: p.y / U };
    } else d.onTrophy = null;
    // after a pour it keeps the balls it had; after a fall, it holds the ones it now rests on, and lets the rest go
    const before = this.props.get(can.id) ?? [];
    const held: number[] = fell ? [] : [...before];
    for (const id of leansOn) {
      const ball = this.balls.find((b) => b.id === id);
      if (!ball || ball.held || ball.pinned || held.includes(id)) continue;
      this.bodies.get(id)?.setStatic();
      held.push(id);
    }
    this.props.set(can.id, held);
    for (const id of before) if (!held.includes(id)) this.loosen(id);
  }

  /**
   * The spec's carry: a damped spring toward the hand, leaning up to about 17 degrees into sideways moves, kept on the page and above
   * the floor. Speeds are per can frame.
   */
  private carryFrame(can: Can, d: Drive): void {
    const K = this.constants();
    const [hw, hh] = this.half(can);
    // the trophy is heavy: it follows the hand more slowly and leans no more than about 3 degrees
    const heavy = can.id === TROPHY_ID;
    const pull = heavy ? 0.12 : 0.2;
    const most = heavy ? TROPHY_LEAN : MAX_LEAN;
    d.vx += (d.target.x - d.from.x) * pull - d.vx * 0.55;
    d.vy += (d.target.y - d.from.y) * pull - d.vy * 0.55;
    let x = d.from.x + d.vx;
    let y = d.from.y + d.vy;
    // moving right tips its top to the right: clockwise, a falling angle
    const lean = -clampTo((d.vx / K.px) * (heavy ? 0.003 : 0.02), -most, most);
    d.av += (lean - d.from.a) * 0.18 - d.av * 0.35;
    // the spring alone would swing it past the lean it is aiming for, to about 21 degrees; the spec's limit is about 17
    const a = clampTo(d.from.a + d.av, -most, most);
    if (a !== d.from.a + d.av) d.av = 0;
    const ca = Math.abs(Math.cos(a));
    const sa = Math.abs(Math.sin(a));
    const across = hw * ca + hh * sa;
    const up = hw * sa + hh * ca;
    x = clampTo(x, across + 4 * K.px, this.width - across - 4 * K.px);
    if (y + up > this.height) y = this.height - up;
    if (y - up < this.floor) y = this.floor + up;
    d.to = { x, y, a };
    // what a let go would start from, kept for it: worked out afresh every other frame while the can moves, kept while it doesn't. On
    // its way out of the bag it would drop back in, which needs none.
    if (this.isEmerging(can.id)) {
      d.preview = null;
      d.rest = null;
      return;
    }
    d.previewAge++;
    const p = d.preview;
    const unchanged = p && p.pose.x === x && p.pose.y === y && p.pose.a === a && p.vx === d.vx / FRAME && p.vy === d.vy / FRAME;
    if (p && (unchanged || d.previewAge < 2)) return;
    const inputs = { pose: d.to, vx: d.vx / FRAME, vy: d.vy / FRAME, w: d.av / FRAME, discs: this.ballSnapshot() };
    // the same sim from the same inputs that a let go runs (see `releaseCan`), so the can lands where this says
    const rest = this.landing(can, inputs, hw, hh);
    // a tumble can end whole turns round; a can stands (see `stand`) with its turn counted from upright again, so that is the turn it shows
    d.rest = { x: rest.x, y: rest.y, a: Math.atan2(Math.sin(rest.a), Math.cos(rest.a)) };
    d.preview = inputs;
    d.previewAge = 0;
  }

  /** Where the carried can would come to rest if it were let go now: the drop preview. Meters, angle counterclockwise. */
  restOf(id: number): Pose | null {
    return this.drives.get(id)?.rest ?? null;
  }

  /** Whether a body is a can in the hand. */
  private carried(body: Body): boolean {
    if (this.trophy && this.trophy.body === body) return this.drives.get(TROPHY_ID)?.state === "held";
    for (const [id, b] of this.canBodies) if (b === body) return this.drives.get(id)?.state === "held";
    return false;
  }

  /** Pick a can up, pressed at a point (meters). A pouring or wiggling can can't be; a falling one can. Whether it was. */
  grabCan(id: number, at: Point): boolean {
    const d = this.drives.get(id);
    const can = this.canOf(id);
    const body = this.bodyOf(id);
    if (!d || !can || !body || d.state === "pour" || d.state === "wiggle") return false;
    if (d.done) this.stand(can, d);
    this.settling.delete(body);
    body.setKinematic();
    this.freeProps(id);
    // another can may have been leaning on this one
    this.supportChanged = true;
    d.onTrophy = null;
    // caught mid-tumble its turn can be whole turns round: from upright again, so the carry doesn't spin it back
    const a = Math.atan2(Math.sin(d.to.a), Math.cos(d.to.a));
    if (a !== d.to.a) {
      d.to = { ...d.to, a };
      body.setTransform(body.getPosition(), a);
      can.angle = can.prevAngle = a;
    }
    d.from = d.to;
    d.state = "held";
    d.body = null;
    d.discs = null;
    d.preview = null;
    d.rest = null;
    d.vx = 0;
    d.vy = 0;
    d.av = 0;
    d.offset = { x: at.x - d.to.x, y: at.y - d.to.y };
    d.target = { x: d.to.x, y: d.to.y };
    can.held = true;
    return true;
  }

  /** Where the hand is now (meters): the carried can follows it. */
  carryCan(id: number, at: Point): void {
    const d = this.drives.get(id);
    if (d?.state === "held") d.target = { x: at.x - d.offset.x, y: at.y - d.offset.y };
  }

  /** Let go of a carried can: it falls and settles from where it is, at the speed it was moving. */
  releaseCan(id: number): void {
    const d = this.drives.get(id);
    const can = this.canOf(id);
    if (!d || !can || d.state !== "held") return;
    can.held = false;
    const [hw, hh] = this.half(can);
    const K = this.constants();
    const p = d.preview ?? { pose: d.to, vx: d.vx / FRAME, vy: d.vy / FRAME, w: d.av / FRAME, discs: this.ballSnapshot() };
    d.discs = p.discs;
    d.body = newBody(clearSpot(p.pose, hw, hh, this.settleWorld(id, p.discs)), p.vx, p.vy, p.w, hw, hh, K);
    // the trophy is heavy: it stands where it lands, no lean assist
    if (id === TROPHY_ID) d.body.lean = 0;
    d.state = "settling";
    d.preview = null;
    d.rest = null;
    this.settling.add(this.bodyOf(id)!);
  }

  // ---- The trophy ----

  /**
   * The trophy: a solid outline (meters, around its anchor) floating at `at` (its anchor) and moved only by `moveTrophy`. Its bowl opens at
   * `mouth`: the middle of the rim, from the anchor, and how far it opens either side. `box`: the box it settles as once it has been
   * touched (see `freeTrophy`), its middle from the anchor and its half sizes; the body then turns about that middle.
   */
  setTrophy(
    outline: Point[],
    mouth: { x: number; y: number; half: number },
    at: Point,
    box: { cx: number; cy: number; hw: number; hh: number },
  ): void {
    this.removeTrophy();
    const rel = outline.map((p) => ({ x: p.x - box.cx, y: p.y - box.cy }));
    const body = this.world.createBody({ type: "kinematic", position: { x: (at.x + box.cx) * U, y: (at.y + box.cy) * U } });
    this.trophyFixture = body.createFixture(new Chain(rel.map((p) => ({ x: p.x * U, y: p.y * U })), true), { friction: params.friction });
    this.trophy = { body, mouth: { ...mouth, x: mouth.x - box.cx, y: mouth.y - box.cy } };
    this.trophyOutline = rel;
    this.trophyBox = box;
    this.supportChanged = true;
  }

  /** Bring the trophy to `at` (its anchor) over the next step, so it pushes balls aside rather than jumping through them. */
  moveTrophy(at: Point): void {
    if (!this.trophy || this.trophyCan) return;
    const p = this.trophy.body.getPosition();
    const { cx, cy } = this.trophyBox!;
    this.trophy.body.setLinearVelocity({ x: ((at.x + cx) * U - p.x) / STEP, y: ((at.y + cy) * U - p.y) / STEP });
  }

  removeTrophy(): void {
    if (this.trophy) {
      this.settling.delete(this.trophy.body);
      this.world.destroyBody(this.trophy.body);
    }
    if (this.trophyCan) {
      this.freeProps(TROPHY_ID);
      this.drives.delete(TROPHY_ID);
    }
    this.trophy = null;
    this.trophyCan = null;
    this.trophyFixture = null;
    this.supportChanged = true;
  }

  /**
   * The trophy has been touched. From now on it is a thing in the court like a can, only heavier: carried on a slow spring with hardly any
   * lean, let go to fall and settle (no lean assist), standing still where it lands, with the balls it rests on held under it. `settle`:
   * it starts falling from where it is (a new window size).
   */
  freeTrophy(settle = false): void {
    if (!this.trophy || !this.trophyBox || this.trophyCan) return;
    const body = this.trophy.body;
    const p = body.getPosition();
    const pose = { x: p.x / U, y: p.y / U, a: body.getAngle() };
    this.trophyCan = { id: TROPHY_ID, seed: 0, x: pose.x, y: pose.y, angle: pose.a, prevX: pose.x, prevY: pose.y, prevAngle: pose.a, vx: 0, vy: 0, held: false, ballsLeft: 0, scale: 1 };
    const drive: Drive = {
      state: "placed",
      from: pose,
      to: pose,
      vx: 0,
      vy: 0,
      av: 0,
      target: { x: pose.x, y: pose.y },
      offset: { x: 0, y: 0 },
      body: null,
      pour: null,
      wiggle: null,
      back: false,
      done: false,
      preview: null,
      previewAge: 0,
      rest: null,
      discs: null,
      onTrophy: null,
    };
    this.drives.set(TROPHY_ID, drive);
    body.setLinearVelocity({ x: 0, y: 0 });
    if (settle) {
      const [hw, hh] = this.half(this.trophyCan);
      drive.state = "settling";
      drive.discs = this.ballSnapshot();
      drive.body = newBody(clearSpot(pose, hw, hh, this.settleWorld(TROPHY_ID, drive.discs)), 0, 0, 0, hw, hh, this.constants());
      drive.body.lean = 0;
      this.settling.add(body);
    } else body.setStatic();
  }

  /** Whether a can (or the trophy, `TROPHY_ID`) is in a hand, and how fast it moves (m/s). Null if there is none. */
  motionOf(id: number): { held: boolean; vx: number; vy: number } | null {
    const c = this.canOf(id);
    return c ? { held: c.held, vx: c.vx, vy: c.vy } : null;
  }

  /**
   * A tap on a can standing still: it lifts, tips its balls out one at a time, and comes back down to exactly where it was. An empty
   * one wiggles instead. `back`: it was lifted out of the open bag for this and goes back in after, lifted clear of the bag and what
   * stands in it first. Returns whether anything happened.
   */
  tapCan(id: number, back = false): boolean {
    const d = this.drives.get(id);
    const can = this.cans.find((c) => c.id === id);
    const body = this.canBodies.get(id);
    if (!d || !can || !body || d.state !== "placed") return false;
    d.back = back;
    body.setKinematic();
    if (can.ballsLeft <= 0) {
      d.state = "wiggle";
      d.wiggle = { left: WIGGLE, a0: d.to.a };
      return true;
    }
    const K = this.constants();
    const [hw, hh] = this.half(can);
    let lift = 36 * K.px * can.scale;
    if (back) {
      // clear of the bag and the tops of what stands in it, as far either side as the tipped can reaches
      let top = -Infinity;
      for (const loop of [...this.bagLoops, ...this.solidLoops]) for (const p of loop) if (Math.abs(p.x - can.x) <= 2 * hh) top = Math.max(top, p.y);
      const foot = can.y - hh * Math.abs(Math.cos(can.angle)) - hw * Math.abs(Math.sin(can.angle));
      lift += Math.max(0, top - foot);
    }
    // toward its lean if it leans, else toward the middle of the page; the other way if the balls would have nowhere to go
    const lean = -Math.atan2(Math.sin(can.angle), Math.cos(can.angle));
    let dir = Math.abs(lean) > 0.2 ? Math.sign(lean) : can.x < this.width / 2 ? 1 : -1;
    const blocked = (dir: number, lift: number) => !this.pourRoom(can, { x: can.x, y: can.y + lift, a: -dir * POUR_TIP }, 0);
    // and higher if need be: a can lying on its side, tipped, points its mouth at what it lies on
    for (let extra = 0; extra <= 0.3; extra += 0.02) {
      if (!blocked(dir, lift + extra)) {
        lift += extra;
        break;
      }
      if (!blocked(-dir, lift + extra)) {
        dir = -dir;
        lift += extra;
        break;
      }
    }
    d.pour = { t: 0, phase: "up", dir, x0: d.to.x, y0: d.to.y, a0: d.to.a, lift, next: 0, tries: can.ballsLeft };
    d.state = "pour";
    return true;
  }

  /** Where a ball poured from a can at `pose` comes out, `u` across the mouth (meters), if it has room there: on the page and not inside anything. */
  private pourRoom(can: Can, pose: Pose, u: number): Point | null {
    const r = params.ballDiameter / 2;
    const [, hh] = this.half(can);
    const v = hh + r + 2 * this.constants().px;
    const c = Math.cos(pose.a);
    const s = Math.sin(pose.a);
    const x = pose.x + u * c - v * s;
    const y = pose.y + u * s + v * c;
    if (x < r || x > this.width - r || y < r + this.floor || !this.canPourAt({ x, y })) return null;
    for (const other of this.cans) {
      if (other.id === can.id) continue;
      const [hw2, hh2] = this.half(other);
      const dx = x - other.x;
      const dy = y - other.y;
      const lu = dx * Math.cos(other.angle) + dy * Math.sin(other.angle);
      const lv = -dx * Math.sin(other.angle) + dy * Math.cos(other.angle);
      if (Math.abs(lu) < hw2 + r && Math.abs(lv) < hh2 + r) return null;
    }
    return { x, y };
  }

  /** One can frame of a pour: up, the balls out one at a time, back down to exactly where it started. */
  private pourFrame(can: Can, d: Drive): void {
    const p = d.pour!;
    p.t += FRAME;
    const tipped = -p.dir * POUR_TIP;
    const pose = (k: number) => ({ x: p.x0, y: p.y0 + p.lift * k, a: p.a0 + (tipped - p.a0) * k });
    if (p.phase === "up") {
      d.to = pose(ease(Math.min(p.t / POUR_UP, 1)));
      if (p.t >= POUR_UP) {
        p.phase = "drop";
        p.t = 0;
        p.next = 0.02;
      }
    } else if (p.phase === "drop") {
      if (p.tries > 0 && p.t >= p.next) {
        this.pourOne(can, d.to);
        p.tries--;
        p.next += POUR_GAP;
      }
      if (p.tries === 0 && p.t >= p.next + POUR_WAIT) {
        p.phase = "down";
        p.t = 0;
      }
    } else {
      d.to = pose(1 - ease(Math.min(p.t / POUR_UP, 1)));
      if (p.t >= POUR_UP) {
        d.to = { x: p.x0, y: p.y0, a: p.a0 };
        d.pour = null;
        d.done = true;
      }
    }
  }

  /** One ball out of a pouring can's mouth, moving out of it (the spec's 160 px/s, give or take 20 sideways). */
  private pourOne(can: Can, pose: Pose): void {
    const K = this.constants();
    const at = this.pourRoom(can, pose, (Math.random() - 0.5) * 4 * K.px * can.scale);
    if (!at) return;
    this.makeRoom();
    const speed = 160 * K.px * K.tf;
    const side = (Math.random() - 0.5) * 40 * K.px * K.tf;
    const ball = this.addBall(at.x, at.y, false, -Math.sin(pose.a) * speed + side, Math.cos(pose.a) * speed);
    ball.pouredFrom = can.seed;
    ball.pouredAt = this.time;
    can.ballsLeft--;
  }

  /** One can frame of the empty can's wiggle: a quick shake that dies away, then exactly as it was. */
  private wiggleFrame(d: Drive): void {
    const w = d.wiggle!;
    w.left -= FRAME;
    if (w.left <= 0) {
      d.to = { ...d.from, a: w.a0 };
      d.wiggle = null;
      d.done = true;
    } else {
      d.to = { ...d.from, a: w.a0 + Math.sin(w.left * 45) * 0.1 * (w.left / WIGGLE) };
    }
  }
}
