import type { Palette } from "./palette";

const TRAIL_MS = 350;
const BURST_MS = 220;
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

interface Timed extends Point {
  t: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private letters = new Path2D();
  private seam = seamRibbon();
  private trails = new Map<number, Timed[]>();
  private bursts: Timed[] = [];
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
  }

  /** The name, as the same closed outlines the balls bounce off. */
  setLetters(outlines: Point[][]): void {
    this.letters = new Path2D();
    for (const loop of outlines) {
      loop.forEach((p, i) => (i ? this.letters.lineTo(p.x, p.y) : this.letters.moveTo(p.x, p.y)));
      this.letters.closePath();
    }
  }

  /** The "pow" where a tap landed. */
  burst(x: number, y: number, now: number): void {
    this.bursts.push({ x, y, t: now });
  }

  /** Start or extend a ball's fading flight path. Call only while the ball is in flight. */
  trail(id: number, x: number, y: number, now: number): void {
    let points = this.trails.get(id);
    if (!points) this.trails.set(id, (points = []));
    points.push({ x, y, t: now });
  }

  /** How many bursts and trail points are on screen right now. For automated checks. */
  effects(): { bursts: number; trailPoints: number } {
    let trailPoints = 0;
    for (const points of this.trails.values()) trailPoints += points.length;
    return { bursts: this.bursts.length, trailPoints };
  }

  /** `rising` are fresh balls on their way up out of a stem; they are drawn behind the letters. */
  draw(now: number, balls: BallSprite[], rising: BallSprite[]): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.palette.navy;
    ctx.fillRect(0, 0, this.width, this.height);

    const radius = balls[0]?.r ?? rising[0]?.r ?? 12;
    this.drawTrails(now, radius);
    for (const b of rising) this.drawBall(b);
    ctx.fillStyle = this.palette.white;
    ctx.fill(this.letters, "evenodd");
    for (const b of balls) this.drawBall(b);
    this.drawBursts(now, radius);
  }

  private drawTrails(now: number, radius: number): void {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    ctx.strokeStyle = this.palette.white;
    ctx.lineWidth = Math.max(1.25, radius * 0.14);
    for (const [id, points] of this.trails) {
      while (points.length && now - points[0].t > TRAIL_MS) points.shift();
      if (!points.length) {
        this.trails.delete(id);
        continue;
      }
      for (let i = 1; i < points.length; i++) {
        const age = (now - points[i].t) / TRAIL_MS;
        ctx.globalAlpha = 0.55 * (1 - age);
        ctx.beginPath();
        ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
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

  /** Eight short spikes flying outward from the point of contact. */
  private drawBursts(now: number, radius: number): void {
    const ctx = this.ctx;
    this.bursts = this.bursts.filter((b) => now - b.t < BURST_MS);
    ctx.strokeStyle = this.palette.white;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.25, radius * 0.1);
    for (const b of this.bursts) {
      const p = (now - b.t) / BURST_MS;
      const eased = 1 - (1 - p) * (1 - p);
      const inner = radius * (0.5 + 1.1 * eased);
      const outer = inner + radius * 0.9 * (1 - p);
      ctx.globalAlpha = 1 - p;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + Math.PI / 8;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(a) * inner, b.y + Math.sin(a) * inner);
        ctx.lineTo(b.x + Math.cos(a) * outer, b.y + Math.sin(a) * outer);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}
