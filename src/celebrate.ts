/**
 * The win: confetti over the whole window, and a camera-flash glint. The confetti is stepped by the court's own clock (`step`), so that when
 * its front has passed is the same on any machine; it is only drawn on the page's frames.
 */
const COLORS = ["#d5e645", "#2e92b9", "#ffffff", "#e3b341", "#f3d36b"];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fall: number;
  w: number;
  h: number;
  angle: number;
  spin: number;
  sway: number;
  swing: number;
  flip: number;
  phase: number;
  color: string;
  round: boolean;
}

export class Confetti {
  private pieces: Piece[];
  private t = 0;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  /** The shower starts spread over 1.3 windows above the top, so it keeps coming. */
  constructor(private width: number, private height: number) {
    const count = Math.round(Math.min(380, Math.max(160, width / 3.5)));
    const r = Math.random;
    this.pieces = Array.from({ length: count }, (_, i) => ({
      x: r() * width,
      y: -16 - r() * height * 1.3,
      vx: (r() - 0.5) * 120,
      vy: 30 + r() * 90,
      fall: 150 + r() * 170, // each falls at its own pace: paper, foil, the odd heavier disc
      w: 6 + r() * 7,
      h: 3 + r() * 4,
      angle: r() * Math.PI * 2,
      spin: (r() - 0.5) * 16,
      sway: 1.2 + r() * 2.6,
      swing: 40 + r() * 90,
      flip: 3 + r() * 7,
      phase: r() * Math.PI * 2,
      color: COLORS[i % COLORS.length],
      round: r() < 0.2,
    }));
    this.canvas = document.createElement("canvas");
    this.canvas.className = "confetti";
    this.canvas.setAttribute("aria-hidden", "true");
    document.body.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.fit();
  }

  private fit(): void {
    this.width = innerWidth;
    this.height = innerHeight;
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  /** Move every piece on by `dt` seconds. */
  step(dt: number): void {
    this.t += dt;
    const t = this.t;
    // a light breeze that comes and goes, pushing the whole shower a little one way, then the other
    const gust = 26 * Math.sin(t * 0.7) + 14 * Math.sin(t * 1.9 + 1);
    for (const p of this.pieces) {
      if (p.y > this.height + 20) continue;
      p.vy = Math.min(p.vy + 380 * dt, p.fall);
      const swing = Math.sin(t * p.sway + p.phase);
      p.x += (p.vx * Math.exp(-t * 0.6) + swing * p.swing + gust) * dt;
      p.y += p.vy * (0.8 + 0.2 * Math.abs(swing)) * dt;
      p.angle += (p.spin + swing * 3) * dt;
    }
  }

  /** Whether its leading pieces (the first 1%) have reached 85% of the window's height: the trophy starts down then, through the rest of it. */
  frontPassed(): boolean {
    let low = 0;
    for (const p of this.pieces) if (p.y >= this.height * 0.85) low++;
    return low >= this.pieces.length * 0.01;
  }

  /** The window's height and every piece's y (page px, down), the ones that have fallen out of the window included. */
  state(): { height: number; ys: number[] } {
    return { height: this.height, ys: this.pieces.map((p) => p.y) };
  }

  /** Whether every piece has fallen out of the window. */
  done(): boolean {
    return this.pieces.every((p) => p.y > this.height + 20);
  }

  draw(): void {
    if (this.canvas.width !== Math.round(innerWidth * this.dpr) || this.canvas.height !== Math.round(innerHeight * this.dpr)) this.fit();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    for (const p of this.pieces) {
      if (p.y > this.height + 20 || p.y < -20) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.h * 0.75, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // a strip turning over as it falls: it narrows and widens, faster than it spins
        const w = p.w * Math.max(0.12, Math.abs(Math.cos(this.t * p.flip + p.phase)));
        ctx.fillRect(-w / 2, -p.h / 2, w, p.h);
      }
      ctx.restore();
    }
  }

  remove(): void {
    this.canvas.remove();
  }
}

/** One camera flash glinting at a point on the page (px), `size` px across. */
export function flash(x: number, y: number, size: number): void {
  const s = 40;
  const star = (len: number, w: number) =>
    "M" + [[0, -len], [w, -w], [len, 0], [w, w], [0, len], [-w, w], [-len, 0], [-w, -w]].map(([a, b]) => `${50 + a} ${50 + b}`).join("L") + "Z";
  const el = document.createElement("div");
  el.className = "glint";
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px` });
  el.innerHTML =
    `<svg viewBox="0 0 100 100" width="100%" height="100%">` +
    `<circle cx="50" cy="50" r="${s * 1.25}" fill="#fff" opacity="0.06"/><circle cx="50" cy="50" r="${s * 0.8}" fill="#fff" opacity="0.1"/>` +
    `<circle cx="50" cy="50" r="${s * 0.5}" fill="#fff" opacity="0.2"/><path d="${star(s * 1.05, s * 0.1)}" fill="#fff" opacity="0.9"/>` +
    `<path d="${star(s * 0.55, s * 0.08)}" transform="rotate(45 50 50)" fill="#fff" opacity="0.6"/><circle cx="50" cy="50" r="${s * 0.3}" fill="#fff"/></svg>`;
  document.body.append(el);
  el.addEventListener("animationend", () => el.remove());
}
