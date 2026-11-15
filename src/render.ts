import type { Palette } from "./palette";
import { params } from "./params";
import { Poof } from "./poof";
import { SHAPE_STRIDE, Trail } from "./trail";

const TAU = Math.PI * 2;

/**
 * The seam, traced from the reference photo of a real ball: a single line that comes in from
 * the left, sweeps up across the face and hooks down around the right side. Unit circle, y down,
 * running a little past the edge at both ends so the ball's outline trims it.
 */
const SEAM: [number, number][] = [
  [-1.06, 0.03],
  [-0.56, -0.18],
  [-0.1, -0.46],
  [0.28, -0.6],
  [0.63, -0.53],
  [0.84, -0.25],
  [0.91, 0.1],
  [0.84, 0.46],
  [0.63, 0.74],
  [0.3, 0.93],
  [0.1, 1.06],
];

/**
 * The seam as a ribbon to fill: the traced points smoothed into one line, widest where it comes
 * in on the left and narrowing around the hook, as it does in the photo.
 */
function seamRibbon(): Path2D {
  const line: [number, number][] = [SEAM[0]];
  let start = SEAM[0];
  for (let i = 1; i < SEAM.length - 1; i++) {
    // Curve through the midpoints between traced points, so they join without corners.
    const control = SEAM[i];
    const next = SEAM[i + 1];
    const end: [number, number] =
      i === SEAM.length - 2 ? next : [(control[0] + next[0]) / 2, (control[1] + next[1]) / 2];
    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      line.push([a * start[0] + b * control[0] + c * end[0], a * start[1] + b * control[1] + c * end[1]]);
    }
    start = end;
  }

  const left: [number, number][] = [];
  const right: [number, number][] = [];
  line.forEach((p, i) => {
    const before = line[Math.max(0, i - 1)];
    const after = line[Math.min(line.length - 1, i + 1)];
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy);
    const half = (0.11 - 0.05 * (i / (line.length - 1))) / 2;
    left.push([p[0] - (dy / length) * half, p[1] + (dx / length) * half]);
    right.push([p[0] + (dy / length) * half, p[1] - (dx / length) * half]);
  });

  const ribbon = new Path2D();
  [...left, ...right.reverse()].forEach(([x, y], i) => (i ? ribbon.lineTo(x, y) : ribbon.moveTo(x, y)));
  ribbon.closePath();
  return ribbon;
}

/** What the renderer needs to know about a ball. Screen space: CSS pixels, y down, angle clockwise. */
export interface BallSprite {
  id: number;
  x: number;
  y: number;
  r: number;
  angle: number;
}

interface Point {
  x: number;
  y: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private letters = new Path2D();
  private seam = seamRibbon();
  private trails = new Trail();
  private poofs = new Poof();
  private livePieces = 0;
  private lastDraw = 0;
  /** The last ball radius seen, so chips keep their size while no ball is on the court, as just after Clear. */
  private ballRadius = 12;
  width = 0;
  height = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private palette: Palette,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
  }

  /** Match the canvas to its on-screen size at the display's pixel density. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // A resize rebuilds the court, and its balls start again from number 1: no flight carries over.
    this.trails.endFlights();
  }

  /** The name, as the same closed outlines the balls bounce off. */
  setLetters(outlines: Point[][]): void {
    this.letters = new Path2D();
    for (const loop of outlines) {
      loop.forEach((p, i) => (i ? this.letters.lineTo(p.x, p.y) : this.letters.moveTo(p.x, p.y)));
      this.letters.closePath();
    }
  }

  /** The poof where a tap landed. */
  burst(x: number, y: number, now: number): void {
    this.poofs.add(x, y, now);
  }

  /** Start or extend a ball's trail. Call only while the ball is in flight or being carried. */
  trail(ball: BallSprite, now: number): void {
    this.trails.follow(ball.id, ball.x, ball.y, ball.r, now);
  }

  /** How many bursts and trail chips are on screen right now. For automated checks. */
  effects(): { bursts: number; trailPoints: number } {
    return { bursts: this.poofs.live(this.lastDraw), trailPoints: this.livePieces };
  }

  /** `rising` are fresh balls on their way up out of a stem; they are drawn behind the letters. */
  draw(now: number, balls: BallSprite[], rising: BallSprite[]): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.palette.navy;
    ctx.fillRect(0, 0, this.width, this.height);

    if (balls.length) this.ballRadius = balls[0].r;
    this.lastDraw = now;
    this.drawChips(now);
    for (const b of rising) this.drawBall(b);
    ctx.fillStyle = this.palette.white;
    ctx.fill(this.letters, "evenodd");
    for (const b of balls) this.drawBall(b);
  }

  /**
   * Every living chip of the trails and the poofs as a flat white rectangle, all in one path and
   * filled once, so chips that overlap make one solid shape rather than a darker patch. They are
   * drawn behind the balls and the name.
   */
  private drawChips(now: number): void {
    const trailCount = this.trails.shapes(now, this.ballRadius);
    const poofCount = this.poofs.shapes(now, this.ballRadius);
    this.livePieces = trailCount;
    if (!trailCount && !poofCount) return;
    const ctx = this.ctx;
    ctx.fillStyle = this.palette.white;
    ctx.globalAlpha = params.trailOpacity;
    ctx.beginPath();
    this.addChips(this.trails.out, trailCount);
    this.addChips(this.poofs.out, poofCount);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Add the first `count` chips of `shapes` to the current path, each as a rectangle. */
  private addChips(shapes: Float32Array, count: number): void {
    const ctx = this.ctx;
    for (let i = 0; i < count; i++) {
      const o = i * SHAPE_STRIDE;
      const x = shapes[o];
      const y = shapes[o + 1];
      // Half the chip's length along its long side, and half its thickness across it.
      const lx = shapes[o + 2] * shapes[o + 4];
      const ly = shapes[o + 2] * shapes[o + 5];
      const tx = -shapes[o + 3] * shapes[o + 5];
      const ty = shapes[o + 3] * shapes[o + 4];
      ctx.moveTo(x + lx + tx, y + ly + ty);
      ctx.lineTo(x - lx + tx, y - ly + ty);
      ctx.lineTo(x - lx - tx, y - ly - ty);
      ctx.lineTo(x + lx - tx, y + ly - ty);
    }
  }

  /**
   * A flat ball: one circle, a sliver of deeper green along its lower left as the only hint of
   * felt, and one tapering seam line, which turns with the ball so spin is visible.
   */
  private drawBall(b: BallSprite): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, TAU);
    ctx.fillStyle = this.palette.ballShade;
    ctx.fill();
    ctx.clip();
    ctx.beginPath();
    ctx.arc(b.r * 0.12, -b.r * 0.12, b.r, 0, TAU);
    ctx.fillStyle = this.palette.ball;
    ctx.fill();

    ctx.rotate(b.angle);
    ctx.scale(b.r, b.r);
    ctx.fillStyle = this.palette.white;
    ctx.fill(this.seam);
    ctx.restore();
  }
}
