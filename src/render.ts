import type { Palette } from "./palette";

const TRAIL_MS = 350;
const BURST_MS = 220;
const TAU = Math.PI * 2;

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
    ctx.lineWidth = Math.max(1.5, radius * 0.28);
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
   * A flat ball: one circle, a sliver of deeper green along its lower right as the only hint of
   * felt, and two white seam lines, which turn with the ball so spin is visible.
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
    ctx.arc(-b.r * 0.14, -b.r * 0.14, b.r, 0, TAU);
    ctx.fillStyle = this.palette.ball;
    ctx.fill();
    ctx.rotate(b.angle);
    ctx.strokeStyle = this.palette.white;
    ctx.lineWidth = Math.max(1.5, b.r * 0.16);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * b.r * 1.3, 0, b.r * 0.95, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Eight short spikes flying outward from the point of contact. */
  private drawBursts(now: number, radius: number): void {
    const ctx = this.ctx;
    this.bursts = this.bursts.filter((b) => now - b.t < BURST_MS);
    ctx.strokeStyle = this.palette.white;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.5, radius * 0.18);
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
