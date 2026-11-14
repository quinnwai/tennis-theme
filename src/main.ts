import { Gestures, type BallView, type Vec } from "./input";
import { readPalette } from "./palette";
import { params } from "./params";
import { Court, STEP, type Ball } from "./physics";
import { Renderer, type BallSprite } from "./render";
import { mountTuner } from "./tune";
import { layoutName, type NameLayout } from "./wordmark";

const REFILLS = 3; // balls waiting in each can, besides the dot on show
const REFILL_DELAY_MS = 1200; // longer than a tapped ball takes to go straight up and come back down
const RISE_MS = 260; // how long a fresh ball takes to rise out of the stem
const TRAIL_MIN_SPEED = 1; // m/s; slower balls leave no trail

/** An "i": the spot where its dot sits, and the can of spare balls in its stem. Meters, y up. */
interface Home {
  x: number;
  y: number;
  stemTop: number;
  ballId: number | null;
  left: number;
  emptySince: number;
  risingSince: number | null;
}

function main(): void {
  const canvas = document.getElementById("court") as HTMLCanvasElement;
  const renderer = new Renderer(canvas, readPalette());
  const contact = document.querySelector<HTMLElement>(".contact")!;
  const toggle = contact.querySelector<HTMLButtonElement>(".toggle")!;

  let layout!: NameLayout;
  let pxPerMeter = 1;
  let radiusPx = 1;
  let court!: Court;
  let homes: Home[] = [];
  let simMs = 0;
  let lastHit: { id: number; dir: Vec; at: Vec } | null = null;

  const toMeters = (p: Vec): Vec => ({ x: p.x / pxPerMeter, y: (renderer.height - p.y) / pxPerMeter });
  const toScreen = (x: number, y: number): Vec => ({ x: x * pxPerMeter, y: renderer.height - y * pxPerMeter });

  /**
   * Lay the name out for the current window and build the world around it. The dot of the "i"
   * is a real ball's size, which fixes how many pixels make a meter. On a resize, loose balls
   * keep their place relative to the letters.
   */
  function build(): void {
    const loose = court
      ? court.balls
          .filter((b) => !b.pinned)
          .map((b) => {
            const s = toScreen(b.x, b.y);
            return { x: (s.x - layout.origin.x) / layout.emPx, y: (layout.origin.y - s.y) / layout.emPx };
          })
      : [];
    const before = homes;

    renderer.resize();
    layout = layoutName(renderer.width, renderer.height);
    renderer.setLetters(layout.outlines);
    radiusPx = layout.ballPx / 2;
    pxPerMeter = layout.ballPx / params.ballDiameter;
    const width = renderer.width / pxPerMeter;
    const height = renderer.height / pxPerMeter;
    // The contact button is a solid disc in the corner: balls bounce off it.
    const box = toggle.getBoundingClientRect();
    const peg = {
      ...toMeters({ x: box.left + box.width / 2, y: box.top + box.height / 2 }),
      radius: box.width / 2 / pxPerMeter,
    };
    court = new Court(
      width,
      height,
      layout.outlines.map((loop) => loop.map(toMeters)),
      [peg],
    );

    homes = layout.dots.map((dot, i) => {
      const at = toMeters(dot);
      const old = before[i];
      const home: Home = {
        x: at.x,
        y: at.y,
        stemTop: toMeters(layout.stemTops[i]).y,
        ballId: null,
        left: old ? old.left : REFILLS,
        emptySince: simMs,
        risingSince: null,
      };
      if (!old || old.ballId !== null || old.risingSince !== null) home.ballId = court.addBall(at.x, at.y, true).id;
      return home;
    });

    const radius = params.ballDiameter / 2;
    for (const b of loose) {
      const at = toMeters({ x: layout.origin.x + b.x * layout.emPx, y: layout.origin.y - b.y * layout.emPx });
      court.addBall(Math.min(width - radius, Math.max(radius, at.x)), Math.max(radius, at.y), false);
    }
  }

  function views(): BallView[] {
    return court.balls.map((b) => ({ id: b.id, ...toScreen(b.x, b.y), r: radiusPx }));
  }

  function sprite(b: Ball, alpha: number): BallSprite {
    const at = toScreen(b.prevX + (b.x - b.prevX) * alpha, b.prevY + (b.y - b.prevY) * alpha);
    return { id: b.id, ...at, r: radiusPx, angle: -(b.prevAngle + (b.angle - b.prevAngle) * alpha) };
  }

  /** Fresh balls on their way up from inside a stem to the dot's place. */
  function risingSprites(): BallSprite[] {
    const sprites: BallSprite[] = [];
    for (const home of homes) {
      if (home.risingSince === null) continue;
      const p = Math.min(1, (simMs - home.risingSince) / RISE_MS);
      const eased = 1 - (1 - p) * (1 - p);
      const from = home.stemTop - params.ballDiameter / 2;
      sprites.push({ id: -1, ...toScreen(home.x, from + (home.y - from) * eased), r: radiusPx, angle: 0 });
    }
    return sprites;
  }

  const gestures = new Gestures(views, {
    hit(id, dir, at) {
      court.hit(id, dir.x, -dir.y);
      renderer.burst(at.x, at.y, performance.now());
      lastHit = { id, dir, at };
    },
    grab(id, at) {
      court.grab(id);
      const p = toMeters(at);
      court.carryTo(p.x, p.y);
    },
    carry(at) {
      const p = toMeters(at);
      court.carryTo(p.x, p.y);
    },
    release(velocity) {
      court.release(velocity.x / pxPerMeter, -velocity.y / pxPerMeter);
    },
  });

  /** Keep each "i" dotted while its can has balls, and refill both cans once every ball is gone. */
  function supply(): void {
    for (const home of homes) {
      if (home.ballId !== null) {
        const ball = court.balls.find((b) => b.id === home.ballId);
        if (ball?.pinned) continue;
        home.ballId = null;
        home.emptySince = simMs;
      }
      if (home.risingSince !== null) {
        if (simMs - home.risingSince < RISE_MS) continue;
        home.risingSince = null;
        home.ballId = court.addBall(home.x, home.y, true).id;
        continue;
      }
      if (home.left === 0 || simMs - home.emptySince < REFILL_DELAY_MS) continue;
      // A fresh ball rises only when nothing sits on the stem or hangs above it, about to land there.
      const clear = court.balls.every(
        (b) => Math.abs(b.x - home.x) > params.ballDiameter * 1.5 || b.y < home.stemTop,
      );
      if (!clear) continue;
      home.risingSince = simMs;
      home.left--;
    }
    const empty = homes.every((h) => h.left === 0 && h.risingSince === null);
    if (court.balls.length === 0 && empty) {
      for (const home of homes) home.left = REFILLS + 1;
    }
  }

  function stepOnce(): void {
    court.step();
    simMs += STEP * 1000;
    supply();
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    gestures.down(e.clientX, e.clientY, e.timeStamp);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    gestures.move(e.clientX, e.clientY, e.timeStamp);
    if (e.buttons === 0) canvas.style.cursor = hoverCursor(e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerup", (e) => gestures.up(e.timeStamp));
  canvas.addEventListener("pointercancel", () => gestures.cancel());

  function hoverCursor(x: number, y: number): string {
    let nearest = Infinity;
    for (const b of views()) nearest = Math.min(nearest, Math.hypot(b.x - x, b.y - y));
    if (nearest <= Math.max(radiusPx * params.grabReach, params.minGrabReachPx)) return "grab";
    if (nearest <= Math.max(radiusPx * params.hitReach, params.minHitReachPx)) return "pointer";
    return "default";
  }

  // Hovering or tabbing to the contact button opens its links through CSS; a click or tap pins them open.
  toggle.addEventListener("click", () => {
    const open = contact.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      gestures.cancel();
      build();
    }, 150);
  });

  build();
  if (new URLSearchParams(location.search).has("tune")) mountTuner(() => court.applyParams());

  let last = performance.now();
  let pending = 0;
  function frame(now: number): void {
    pending += Math.min(0.1, (now - last) / 1000);
    last = now;
    gestures.tick(now);
    while (pending >= STEP) {
      stepOnce();
      pending -= STEP;
    }
    const alpha = pending / STEP;
    const sprites = court.balls.map((b) => sprite(b, alpha));
    court.balls.forEach((b, i) => {
      if (!b.pinned && !b.held && Math.hypot(b.vx, b.vy) > TRAIL_MIN_SPEED) {
        renderer.trail(b.id, sprites[i].x, sprites[i].y, now);
      }
    });
    renderer.draw(now, sprites, risingSprites());
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // A window into the toy for automated browser checks. Screen units: px and px/s, y down.
  Object.assign(window, {
    __sandbox: {
      params,
      layout: () => layout,
      balls: () =>
        court.balls.map((b) => ({
          id: b.id,
          pinned: b.pinned,
          held: b.held,
          ...toScreen(b.x, b.y),
          vx: b.vx * pxPerMeter,
          vy: -b.vy * pxPerMeter,
          r: radiusPx,
        })),
      lastHit: () => lastHit,
      effects: () => renderer.effects(),
      pxPerMeter: () => pxPerMeter,
      /** Run the simulation forward without waiting for frames. */
      advance(seconds: number) {
        for (let i = 0; i < Math.round(seconds / STEP); i++) stepOnce();
      },
    },
  });
}

main();
