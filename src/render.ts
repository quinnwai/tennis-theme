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

/** A picture turned about a point, such as a can of balls out of the bag. */
/** The drop preview: a can's shadow where it would come to rest. Its middle (page px), its turn (radians clockwise), its size (px)
 * and how strongly it shows (0 to 1). */
export interface Ghost {
  /** The can it is the shadow of. */
  id: number;
  x: number;
  y: number;
  angle: number;
  w: number;
  h: number;
  alpha: number;
  /** The trophy's picture, drawn as a shadow of its own shape: where it sits about the point (x, y), px, unturned. */
  image?: { img: CanvasImageSource; x: number; y: number; w: number; h: number };
}

export interface ImageSprite {
  img: CanvasImageSource;
  /** The point it turns about, page px, and its turn, radians clockwise. */
  x: number;
  y: number;
  angle: number;
  /** Its size, px, and where in it the point (x, y) is, px from its top left. */
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** An outline on the page (px) it is hidden behind, such as the bag's front for a can coming out of it. */
  behind?: [number, number][];
}

/** A ball's shadow on the surface under it: a flat ellipse seen at the scene camera's angle. */
export interface ShadowSprite {
  x: number;
  y: number;
  rx: number;
  ry: number;
  alpha: number;
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
  /** Leave the background clear, so the scene drawn behind the canvas (the bench and the bag) shows through. */
  clearBackground = false;
  /** How the balls' shadows are drawn: their color, and the camera's shear (degrees, as skewX). */
  shadowColor = "#000";
  shadowSkew = 0;

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
  draw(
    now: number,
    balls: BallSprite[],
    rising: BallSprite[],
    shadows: ShadowSprite[] = [],
    props: ImageSprite[] = [],
    ghosts: Ghost[] = [],
    over: { sprite: BallSprite; hide: [number, number][] }[] = [],
  ): void {
    const ctx = this.ctx;
    if (this.clearBackground) {
      ctx.clearRect(0, 0, this.width, this.height);
    } else {
      ctx.fillStyle = this.palette.navy;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    if (balls.length) this.ballRadius = balls[0].r;
    this.lastDraw = now;
    this.drawShadows(shadows);
    this.drawChips(now);
    for (const b of rising) this.drawBall(b);
    ctx.fillStyle = this.palette.white;
    ctx.fill(this.letters, "evenodd");
    this.drawGhosts(ghosts);
    for (const p of props) {
      ctx.save();
      if (p.behind) {
        // everything but the outline it is behind
        const clip = new Path2D();
        clip.rect(0, 0, this.width, this.height);
        p.behind.forEach(([x, y], i) => (i ? clip.lineTo(x, y) : clip.moveTo(x, y)));
        clip.closePath();
        ctx.clip(clip, "evenodd");
      }
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.drawImage(this.raster(p.img, p.w, p.h), -p.ox, -p.oy, p.w, p.h);
      ctx.restore();
    }
    // balls going into the trophy, over its picture, but not over the front of its cup
    for (const o of over) {
      ctx.save();
      const clip = new Path2D();
      clip.rect(0, 0, this.width, this.height);
      o.hide.forEach(([x, y], i) => (i ? clip.lineTo(x, y) : clip.moveTo(x, y)));
      clip.closePath();
      ctx.clip(clip, "evenodd");
      this.drawBall(o.sprite);
      ctx.restore();
    }
    for (const b of balls) this.drawBall(b);
  }

  private rasters = new Map<CanvasImageSource, HTMLCanvasElement>();

  /**
   * A picture drawn once, to draw from every frame after. Drawing the trophy's vector picture itself, turned, costs the browser a fresh
   * render of all its shapes each frame; on a slow machine that made the frames of the trophy coming down and being carried take longer
   * than a 60th of a second. The trophy changes size as it comes down and is fitted to the window, so the copy is made a quarter larger
   * than asked and kept while the picture is shown between half and all of its size, so it is not remade every frame of a change.
   * `w`, `h`: the size it is shown at (page px).
   */
  private raster(img: CanvasImageSource, w: number, h: number): CanvasImageSource {
    const dpr = window.devicePixelRatio || 1;
    const [pw, ph] = [Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr))];
    const have = this.rasters.get(img);
    if (have && have.width >= pw && have.width <= pw * 2) return have;
    const canvas = have ?? document.createElement("canvas");
    canvas.width = Math.round(pw * 1.25);
    canvas.height = Math.round(ph * 1.25);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    this.rasters.set(img, canvas);
    return canvas;
  }

  /** How strongly the drop preview shows at full strength, and the faint rim that keeps it readable on the darkest things it can land on. */
  ghostOpacity = 0.55;
  ghostRimOpacity = 0.16;

  /** The drop preview: a can's dark shadow in the scene's shadow colour, with a faint rim of the page's quiet grey. */
  private drawGhosts(ghosts: Ghost[]): void {
    const ctx = this.ctx;
    for (const g of ghosts) {
      if (g.alpha <= 0.01) continue;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angle);
      if (g.image) {
        // the trophy: its own shape, handles and all
        const { canvas, pad } = this.silhouette(g.image);
        ctx.globalAlpha = this.ghostOpacity * g.alpha;
        ctx.drawImage(canvas, g.image.x - pad, g.image.y - pad, g.image.w + 2 * pad, g.image.h + 2 * pad);
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      ctx.roundRect(-g.w / 2, -g.h / 2, g.w, g.h, g.w * 0.14);
      ctx.globalAlpha = this.ghostOpacity * g.alpha;
      ctx.fillStyle = this.shadowColor;
      ctx.fill();
      ctx.globalAlpha = this.ghostRimOpacity * g.alpha;
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.palette.quiet || this.palette.white;
      ctx.stroke();
      ctx.restore();
    }
  }

  private shape: { key: string; canvas: HTMLCanvasElement; pad: number } | null = null;

  /**
   * A picture's shape in the shadow colour, with the faint rim the cans' shadows have just outside it,
   * made once for each size. `pad`: the room around the picture for the rim (px).
   */
  private silhouette(image: NonNullable<Ghost["image"]>): { canvas: HTMLCanvasElement; pad: number } {
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = [Math.max(1, Math.round(image.w * dpr)), Math.max(1, Math.round(image.h * dpr))];
    const key = `${w}x${h} ${this.shadowColor} ${this.palette.quiet}`;
    if (this.shape?.key === key) return this.shape;
    const edge = Math.max(1, Math.round(dpr));
    const make = () => {
      const c = document.createElement("canvas");
      [c.width, c.height] = [w + 2 * edge, h + 2 * edge];
      return [c, c.getContext("2d")!] as const;
    };
    // the rim: the shape grown by a pixel all round, less the shape
    const [rim, r] = make();
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]])
      r.drawImage(image.img, edge + dx * edge, edge + dy * edge, w, h);
    r.globalCompositeOperation = "destination-out";
    r.drawImage(image.img, edge, edge, w, h);
    r.globalCompositeOperation = "source-in";
    r.fillStyle = this.palette.quiet || this.palette.white;
    r.fillRect(0, 0, rim.width, rim.height);
    // the shape, filled with the shadow colour, then the rim at its strength relative to the fill's
    const [canvas, c] = make();
    c.drawImage(image.img, edge, edge, w, h);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = this.shadowColor;
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = this.ghostRimOpacity / this.ghostOpacity;
    c.drawImage(rim, 0, 0);
    this.shape = { key, canvas, pad: edge / dpr };
    return this.shape;
  }

  private drawShadows(shadows: ShadowSprite[]): void {
    if (!shadows.length) return;
    const ctx = this.ctx;
    const shear = Math.tan((this.shadowSkew * Math.PI) / 180);
    ctx.fillStyle = this.shadowColor;
    for (const s of shadows) {
      if (s.alpha <= 0) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.transform(1, 0, shear, 1, 0, 0);
      ctx.globalAlpha = s.alpha;
      ctx.beginPath();
      ctx.ellipse(0, 0, s.rx, s.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
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
