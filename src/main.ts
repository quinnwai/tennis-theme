import { Gestures, type BallView, type Vec } from "./input";
import { startMeasuring } from "./measure";
import { readPalette } from "./palette";
import { params } from "./params";
import { Court, STEP, type Ball } from "./physics";
import { Renderer, type BallSprite } from "./render";
import { mountTuner } from "./tune";
import { layoutName, type NameLayout } from "./wordmark";
import { WORDMARKS } from "./wordmark.data";

const REFILL_DELAY_MS = 1200; // longer than a tapped ball takes to go straight up and come back down
const RISE_MS = 260; // how long a fresh ball takes to rise out of the stem
const TRAIL_MIN_SPEED = 1; // m/s; slower balls leave no trail
const MAX_BALLS = 60; // past this, the oldest loose ball makes way for each new one

/** An "i": the spot where its dot sits. Its stem never runs out of balls. Meters, y up. */
interface Home {
  x: number;
  y: number;
  stemTop: number;
  ballId: number | null;
  emptySince: number;
  risingSince: number | null;
}

function main(): void {
  const canvas = document.getElementById("court") as HTMLCanvasElement;
  const renderer = new Renderer(canvas, readPalette());
  const contact = document.querySelector<HTMLElement>(".contact")!;
  const toggle = contact.querySelector<HTMLButtonElement>(".toggle")!;
  const creditsChip = document.querySelector<HTMLButtonElement>(".chip.credits")!;
  const credits = document.querySelector<HTMLDialogElement>(".credits-overlay")!;
  const creditsText = credits.querySelector<HTMLElement>(".credits-text")!;
  const creditsClose = credits.querySelector<HTMLButtonElement>(".close")!;
  const clearButton = document.querySelector<HTMLButtonElement>(".chip.clear")!;

  // The name is set in Ubuntu. Add ?font=roboto-mono to the address to compare.
  const query = new URLSearchParams(location.search);
  const mark = WORDMARKS[query.get("font") ?? ""] ?? WORDMARKS.ubuntu;

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
   * Lay the name out for the current window and build the world around it. A ball is a real
   * ball's size, which fixes how many pixels make a meter. On a rebuild, loose balls keep
   * their place relative to the letters.
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
    layout = layoutName(renderer.width, renderer.height, mark, params.ballScale);
    const outlines = layout.letters.flatMap((letter) => letter.loops);
    renderer.setLetters(outlines);
    radiusPx = layout.ballPx / 2;
    pxPerMeter = layout.ballPx / params.ballDiameter;
    const width = renderer.width / pxPerMeter;
    const height = renderer.height / pxPerMeter;

    // The two buttons at the bottom right are solid discs: balls bounce off them.
    const pegs = [toggle, creditsChip].map((chip) => {
      const box = chip.getBoundingClientRect();
      return {
        ...toMeters({ x: box.left + box.width / 2, y: box.top + box.height / 2 }),
        radius: box.width / 2 / pxPerMeter,
      };
    });
    court = new Court(
      width,
      height,
      outlines.map((loop) => loop.map(toMeters)),
      pegs,
    );

    homes = layout.dots.map((dot, i) => {
      const at = toMeters(dot);
      const old = before[i];
      const home: Home = {
        x: at.x,
        y: at.y,
        stemTop: toMeters(layout.stemTops[i]).y,
        ballId: null,
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

  /** Fresh balls on their way out of a stem: each starts small at the top of the stem and grows into the dot's place. */
  function risingSprites(): BallSprite[] {
    const sprites: BallSprite[] = [];
    for (const home of homes) {
      if (home.risingSince === null) continue;
      const p = Math.min(1, (simMs - home.risingSince) / RISE_MS);
      const eased = 1 - (1 - p) * (1 - p);
      const at = toScreen(home.x, home.stemTop + (home.y - home.stemTop) * eased);
      sprites.push({ id: -1, ...at, r: radiusPx * (0.55 + 0.45 * eased), angle: 0 });
    }
    return sprites;
  }

  const noteInteraction = startMeasuring();
  const gestures = new Gestures(views, {
    hit(id, dir, at) {
      noteInteraction();
      court.hit(id, dir.x, -dir.y);
      renderer.burst(at.x, at.y, performance.now());
      lastHit = { id, dir, at };
    },
    grab(id, at) {
      noteInteraction();
      court.grab(id);
      const p = toMeters(at);
      court.carryTo(p.x, p.y);
    },
    carry(at) {
      noteInteraction();
      const p = toMeters(at);
      court.carryTo(p.x, p.y);
    },
    release() {
      noteInteraction();
      court.release();
    },
  });

  /** Keep each "i" dotted: whenever its dot is gone, a fresh ball rises out of the stem. */
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
      if (simMs - home.emptySince < REFILL_DELAY_MS) continue;
      // A fresh ball rises only when nothing sits on the stem or hangs above it, about to land there.
      const clear = court.balls.every(
        (b) => Math.abs(b.x - home.x) > params.ballDiameter * 1.5 || b.y < home.stemTop,
      );
      if (!clear) continue;
      // The supply never runs out, so the court has a ceiling instead: the oldest loose ball goes.
      if (court.balls.length >= MAX_BALLS) {
        const oldest = court.balls.find((b) => !b.pinned && !b.held);
        if (oldest) court.remove(oldest.id);
      }
      home.risingSince = simMs;
    }
  }

  function stepOnce(): void {
    court.step();
    simMs += STEP * 1000;
    supply();
  }

  /** Sweep every ball off the court and let both dots rise again. */
  function reset(): void {
    gestures.cancel();
    for (const ball of [...court.balls]) court.remove(ball.id);
    for (const home of homes) {
      home.ballId = null;
      home.risingSince = null;
      home.emptySince = simMs - REFILL_DELAY_MS;
    }
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    gestures.down(e.clientX, e.clientY, e.timeStamp);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    gestures.move(e.clientX, e.clientY);
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
  clearButton.addEventListener("click", reset);

  // The credits open over the toy, which keeps running behind them. A modal dialog brings Escape, focus and a
  // shut-out page with it. With ?tune the sliders have to stay in reach, so there it opens as a plain dialog that
  // sits under them instead, and Escape is handled here.
  creditsChip.addEventListener("click", () => (query.has("tune") ? credits.show() : credits.showModal()));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") credits.close();
  });
  creditsClose.addEventListener("click", () => credits.close());
  // A click on the dimmed toy around the text closes it too. The press has to start out there as well as end
  // there: selecting a name and letting go beside the text is not a click outside it.
  let pressedOutside = false;
  credits.addEventListener("pointerdown", (e) => (pressedOutside = !creditsText.contains(e.target as Node)));
  credits.addEventListener("click", (e) => {
    if (pressedOutside && !creditsText.contains(e.target as Node)) credits.close();
  });

  /** How blurred and how dimmed the toy is behind the credits. The stylesheet reads both from these properties. */
  function styleCredits(): void {
    const root = document.documentElement.style;
    root.setProperty("--credits-blur", `${params.creditsBlur}px`);
    root.setProperty("--credits-dim", String(params.creditsDim));
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      gestures.cancel();
      build();
    }, 150);
  });

  styleCredits();
  build();
  if (query.has("tune")) {
    // The credits' look is only CSS, so changing it needs no new court (a new court would stop every ball in
    // the air); every other number does.
    mountTuner((changed) => (changed.startsWith("credits") ? styleCredits() : build()));
  }

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
      /** Whether each "i" has its dot right now. */
      dots: () => homes.map((h) => h.ballId !== null),
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
