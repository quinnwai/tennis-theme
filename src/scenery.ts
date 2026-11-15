// Drawing the bench, the bag with its zip, the notebook and the cans, flat, in the page's own colors: no outlines, no shading but a
// band or two of a darker tone, the way the ball has one sliver of shade. What the shapes are, and where, is in bench.ts, bag.ts, cans.ts
// and furniture.ts (meters, y up); this turns that into pixels (y down) and paints it.

import { BAG_CORNER, pullAt } from "./bag";
import { CAN_HEIGHT, CAN_WIDTH } from "./cans";
import type { Furniture } from "./furniture";
import type { Point } from "./geometry";
import type { Palette } from "./palette";
import { params } from "./params";
import type { BallSprite } from "./render";

/** A can as it is drawn. Screen space: px, y down, `angle` clockwise. */
export interface CanSprite {
  x: number;
  y: number;
  angle: number;
  /** The balls in it. The top one shows over the rim, and an empty can shows none. */
  balls: number;
  /** Still on its way out of the bag: the bag is drawn in front of it, so that it comes up out of it. */
  inBag: boolean;
}

/** What the renderer asks for: something drawn behind the trails, the name and the balls, and something in front of the trails but still behind them. */
export interface Props {
  behind(ctx: CanvasRenderingContext2D): void;
  front(ctx: CanvasRenderingContext2D, drawBall: (ball: BallSprite) => void): void;
}

/** A small pseudo-random number generator, so that the notebook's marbling is the same on every visit and in every test. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The white flecks of a composition book's cover, as one shape in a unit square, so that they can be drawn at any size in one fill. */
function marbling(): Path2D {
  const random = seeded(2013);
  const flecks = new Path2D();
  for (let i = 0; i < 120; i++) {
    const long = 0.012 + random() * 0.03;
    flecks.ellipse(random(), random(), long, long * (0.35 + random() * 0.4), random() * Math.PI, 0, Math.PI * 2);
    flecks.closePath();
  }
  return flecks;
}

/** A rectangle with round corners, as a path on `ctx`. (`roundRect` is newer than the browsers this has to run in.) */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** How far the notebook has come up, eased: quick at first, settling at the top, as the ball rising out of a stem does. */
const ease = (p: number) => 1 - (1 - p) * (1 - p);

export class Scenery implements Props {
  furniture: Furniture | null = null;
  /** How far the pull has been dragged along the zip, from 0 (shut) to 1 (open). */
  pull = 0;
  /** How far the notebook has come up out of the bag, from 0 (inside) to 1 (standing out as far as it goes). */
  noteRise = 0;
  cans: CanSprite[] = [];

  private pxPerMeter = 1;
  private height = 0;
  private flecks = marbling();

  constructor(private palette: Palette) {}

  /** The furniture to draw, for a window `height` px tall at `pxPerMeter`. */
  setLayout(furniture: Furniture, pxPerMeter: number, height: number): void {
    this.furniture = furniture;
    this.pxPerMeter = pxPerMeter;
    this.height = height;
  }

  /** Where a point in meters is on screen. */
  private px(p: Point): Point {
    return { x: p.x * this.pxPerMeter, y: this.height - p.y * this.pxPerMeter };
  }

  private fillPolygon(ctx: CanvasRenderingContext2D, points: Point[], color: string): void {
    ctx.beginPath();
    points.map((p) => this.px(p)).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** Everything that stands on the floor, in front of the page and behind the trails, the name and the balls. */
  behind(ctx: CanvasRenderingContext2D): void {
    if (!this.furniture) return;
    this.drawBench(ctx);
    for (const can of this.cans) if (can.inBag) this.drawCan(ctx, can, () => {});
    if (this.noteRise > 0) this.drawNotebook(ctx);
    this.drawBag(ctx);
  }

  /** The cans that are out, in front of the trails (a ball in front of a can is drawn after it, as every ball is). */
  front(ctx: CanvasRenderingContext2D, drawBall: (ball: BallSprite) => void): void {
    if (!this.furniture) return;
    for (const can of this.cans) if (!can.inBag) this.drawCan(ctx, can, drawBall);
  }

  private drawBench(ctx: CanvasRenderingContext2D): void {
    const { bench } = this.furniture!;
    for (const leg of bench.legs) this.fillPolygon(ctx, leg, this.palette.benchLeg);
    this.fillPolygon(ctx, bench.seat, this.palette.bench);
    // The top plank is a lighter tone, a third of the seat's thickness.
    const plank = (bench.seatTop - bench.seatBottom) / 3;
    this.fillPolygon(
      ctx,
      [
        { x: bench.left, y: bench.seatTop - plank },
        { x: bench.right, y: bench.seatTop - plank },
        { x: bench.right, y: bench.seatTop },
        { x: bench.left, y: bench.seatTop },
      ],
      this.palette.benchTop,
    );
  }

  private drawBag(ctx: CanvasRenderingContext2D): void {
    const { bag } = this.furniture!;
    const ppm = this.pxPerMeter;
    const left = bag.left * ppm;
    const right = bag.right * ppm;
    const top = this.height - bag.top * ppm;
    const width = right - left;
    const depth = this.height - bag.bottom * ppm - top;

    ctx.save();
    roundedRect(ctx, left, top, width, depth, BAG_CORNER * ppm);
    ctx.fillStyle = this.palette.bag;
    ctx.fill();
    ctx.clip();
    // A darker band along the bottom: the bag's one hint of volume.
    ctx.fillStyle = this.palette.bagShade;
    ctx.fillRect(left, top + depth * 0.72, width, depth * 0.28);
    ctx.restore();

    // The zip: a thin light line along the top while it is shut, and where the pull has been, a dark slot.
    const seam = this.height - bag.zip.y * ppm;
    const pull = this.px(pullAt(bag, this.pull));
    const start = this.px({ x: bag.zip.x0, y: bag.zip.y });
    const end = this.px({ x: bag.zip.x1, y: bag.zip.y });
    ctx.lineCap = "round";
    ctx.strokeStyle = this.palette.quiet;
    ctx.lineWidth = Math.max(1.5, 0.006 * ppm);
    ctx.beginPath();
    ctx.moveTo(pull.x, seam);
    ctx.lineTo(end.x, seam);
    ctx.stroke();
    if (this.pull > 0) {
      ctx.strokeStyle = this.palette.zipOpen;
      ctx.lineWidth = Math.max(3, 0.016 * ppm);
      ctx.beginPath();
      ctx.moveTo(start.x, seam);
      ctx.lineTo(pull.x, seam);
      ctx.stroke();
    }
    // The pull: a small round head on the zip and a tab hanging under it, in the ball's green so that it catches the eye.
    ctx.fillStyle = this.palette.ball;
    ctx.beginPath();
    ctx.arc(pull.x, seam, Math.max(3, 0.013 * ppm), 0, Math.PI * 2);
    ctx.fill();
    roundedRect(ctx, pull.x - 0.011 * ppm, seam, 0.022 * ppm, 0.052 * ppm, 0.008 * ppm);
    ctx.fill();
  }

  /** The notebook, standing in the bag's opening with most of it down inside. It is drawn before the bag, which hides what is inside. */
  private drawNotebook(ctx: CanvasRenderingContext2D): void {
    const { bag } = this.furniture!;
    const ppm = this.pxPerMeter;
    const stillInside = (bag.notebook.top - bag.top) * (1 - ease(this.noteRise));
    const left = bag.notebook.left * ppm;
    const width = (bag.notebook.right - bag.notebook.left) * ppm;
    const height = (bag.notebook.top - bag.notebook.bottom) * ppm;
    const top = this.height - (bag.notebook.top - stillInside) * ppm;

    ctx.save();
    roundedRect(ctx, left, top, width, height, 0.008 * ppm);
    ctx.fillStyle = this.palette.cover;
    ctx.fill();
    ctx.clip();
    ctx.save();
    ctx.translate(left, top);
    ctx.scale(width, height);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = this.palette.white;
    ctx.fill(this.flecks);
    ctx.restore();
    // The black tape along the spine, and the blank label: a composition book, and no more than that.
    ctx.fillStyle = this.palette.coverTape;
    ctx.fillRect(left, top, width * 0.12, height);
    ctx.fillStyle = this.palette.white;
    roundedRect(ctx, left + width * 0.27, top + height * 0.1, width * 0.5, height * 0.2, 0.005 * ppm);
    ctx.fill();
    ctx.restore();
  }

  /** A can: its top ball showing over the rim, then the body, a rim in a lighter tone, and a white band round the middle. */
  private drawCan(ctx: CanvasRenderingContext2D, can: CanSprite, drawBall: (ball: BallSprite) => void): void {
    const ppm = this.pxPerMeter;
    const w = CAN_WIDTH * ppm;
    const h = CAN_HEIGHT * ppm;
    const cos = Math.cos(can.angle);
    const sin = Math.sin(can.angle);
    if (can.balls > 0) {
      // The ball sits 1 cm below the rim, so that the rim hides the lower part of it; it turns with the can.
      const down = -h / 2 + 0.01 * ppm;
      drawBall({ id: -1, x: can.x - down * sin, y: can.y + down * cos, r: (params.ballDiameter / 2) * ppm, angle: can.angle });
    }
    ctx.save();
    ctx.translate(can.x, can.y);
    ctx.rotate(can.angle);
    roundedRect(ctx, -w / 2, -h / 2, w, h, 0.006 * ppm);
    ctx.fillStyle = this.palette.can;
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = this.palette.canRim;
    ctx.fillRect(-w / 2, -h / 2, w, 0.014 * ppm);
    ctx.fillStyle = this.palette.white;
    ctx.fillRect(-w / 2, -0.03 * ppm, w, 0.06 * ppm);
    ctx.restore();
  }
}
