import { floorLiftFor, iconSizeFor } from "./controls";
import { Gestures, canGap, type BallView, type CanView, type Vec } from "./input";
import { CAN_HEIGHT, CAN_WIDTH } from "./cans";
import { startMeasuring } from "./measure";
import { readPalette } from "./palette";
import { params } from "./params";
import { Court, STEP, type Ball } from "./physics";
import { Renderer, type BallSprite, type ImageSprite, type ShadowSprite } from "./render";
import { Sound, browserEnv, wakeOnGesture } from "./sound";
import { nextSound, readSound, writeSound } from "./sound-setting";
import { leavesTrail } from "./trail";
import { mountTuner } from "./tune";
import { CAN_IMAGE, SHADOW, SHADOW_OPACITY, SKEW, canImage } from "./v6/art";
import { mountNotebook, type Notebook } from "./v6/notebook";
import { Scene } from "./v6/scene";
import { layoutName, type NameLayout } from "./wordmark";
import { WORDMARKS } from "./wordmark.data";

const REFILL_DELAY_MS = 1200; // longer than a tapped ball takes to go straight up and come back down
const RISE_MS = 260; // how long a fresh ball takes to rise out of the stem

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
  const palette = readPalette();
  const renderer = new Renderer(canvas, palette);
  const contact = document.querySelector<HTMLElement>(".contact")!;
  const toggle = contact.querySelector<HTMLButtonElement>(".toggle")!;
  const creditsChip = document.querySelector<HTMLButtonElement>(".chip.credits")!;
  const credits = document.querySelector<HTMLDialogElement>(".credits-overlay")!;
  const creditsText = credits.querySelector<HTMLElement>(".credits-text")!;
  const creditsClose = credits.querySelector<HTMLButtonElement>(".close")!;
  const clearButton = document.querySelector<HTMLButtonElement>(".chip.clear")!;
  const soundChip = document.querySelector<HTMLButtonElement>(".chip.sound")!;

  // Sounds answer what the visitor does, so they only play once the visitor has done something (see sound.ts).
  const sound = new Sound(browserEnv());
  wakeOnGesture(sound, window);

  // The name is set in Ubuntu. Add ?font=roboto-mono to the address to compare.
  const query = new URLSearchParams(location.search);
  const mark = WORDMARKS[query.get("font") ?? ""] ?? WORDMARKS.ubuntu;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let layout!: NameLayout;
  let pxPerMeter = 1;
  let radiusPx = 1;
  let court!: Court;
  let homes: Home[] = [];
  let simMs = 0;
  let lastHit: { id: number; dir: Vec; at: Vec } | null = null;
  /** Set by Restart, until the next supply: the dots come back without the rising pop. */
  let restarted = false;
  /** The solid shapes of the bench and the bag, page px, for keeping poured balls out of them. */
  let sceneLoops: [number, number][][] = [];

  const toMeters = (p: Vec): Vec => ({ x: p.x / pxPerMeter, y: (renderer.height - p.y) / pxPerMeter });
  const toScreen = (x: number, y: number): Vec => ({ x: x * pxPerMeter, y: renderer.height - y * pxPerMeter });

  const noteInteraction = startMeasuring();

  // The bench, the towel, the racquet and the bag are drawn around the canvas (see src/v6). The bag unzips when its pull is dragged; then
  // the cans and the notebook rise out of it. Balls land on the bench and on the bag; a can taken out of the bag is a can of the court.
  renderer.clearBackground = true;
  renderer.shadowColor = SHADOW;
  renderer.shadowSkew = -SKEW;
  document.body.classList.add("v6");
  let notebook!: Notebook;
  const scene = new Scene(
    {
      reducedMotion,
      onSolids: (loops) => applySceneSolids(loops),
      onNotebook: (box, opener) => notebook.open(box, opener),
      onInteraction: () => noteInteraction(),
    },
    canvas,
  );
  notebook = mountNotebook({ reducedMotion, onClosed: () => scene.notebookBack() });

  /** Each can's picture, by which can it is and how many balls are left in it. */
  const canImages = new Map<string, HTMLImageElement>();
  for (const seed of [1, 2, 3]) {
    for (let n = 0; n <= 3; n++) {
      const img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(canImage(seed, n));
      canImages.set(`${seed}:${n}`, img);
    }
  }

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
    // Cans out of the bag keep their place the same way, and keep their balls.
    const cansBefore = court
      ? court.cans.map((c) => {
          const s = toScreen(c.x, c.y);
          return {
            x: (s.x - layout.origin.x) / layout.emPx,
            y: (layout.origin.y - s.y) / layout.emPx,
            angle: c.angle,
            balls: c.ballsLeft,
            seed: c.seed,
          };
        })
      : [];
    const before = homes;

    renderer.resize();
    styleControls(); // the icons' size depends on the window, so it is settled before the buttons are measured below
    layout = layoutName(renderer.width, renderer.height, mark, params.ballScale);
    const outlines = layout.letters.flatMap((letter) => letter.loops);
    renderer.setLetters(outlines);
    radiusPx = layout.ballPx / 2;
    pxPerMeter = layout.ballPx / params.ballDiameter;
    const width = renderer.width / pxPerMeter;
    const height = renderer.height / pxPerMeter;
    const floor = floorLiftFor(matchMedia("(pointer: coarse)").matches) / pxPerMeter; // meters

    // The corner buttons (the "?" at the bottom right, and credits, clear and sound in the row at the top right) are
    // solid discs: balls bounce off them. Each disc is its button's box, so it follows the buttons' size.
    const pegs = [toggle, creditsChip, clearButton, soundChip].map((chip) => {
      const box = chip.getBoundingClientRect();
      return {
        ...toMeters({ x: box.left + box.width / 2, y: box.top + box.height / 2 }),
        radius: box.width / 2 / pxPerMeter,
      };
    });

    // The bench stands right of the middle, cut off by the window's bottom, and the bag stands on its seat.
    const placed = scene.place(renderer.width, renderer.height, layout, floor * pxPerMeter);
    sceneLoops = [placed.bench, placed.bag];
    court = new Court(
      width,
      height,
      outlines.map((loop) => loop.map(toMeters)),
      pegs,
      floor,
      [placed.bench.map(([x, y]) => toMeters({ x, y }))],
    );
    court.setBag([placed.bag.map(([x, y]) => toMeters({ x, y }))]);
    applySceneSolids(scene.openSolids());
    court.canPourAt = (at) => !insideSolid(toScreen(at.x, at.y));

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
      court.addBall(Math.min(width - radius, Math.max(radius, at.x)), Math.max(radius + floor, at.y), false);
    }
    for (const c of cansBefore) {
      const at = toMeters({ x: layout.origin.x + c.x * layout.emPx, y: layout.origin.y - c.y * layout.emPx });
      court.addCan(Math.min(width - CAN_WIDTH, Math.max(CAN_WIDTH, at.x)), Math.max(CAN_HEIGHT / 2 + floor, at.y), c.angle, c.balls, c.seed);
    }
  }

  /** What stands in the open bag, as solids in the court. Page px in. */
  function applySceneSolids(loops: [number, number][][]): void {
    court?.setSolids(loops.map((loop) => loop.map(([x, y]) => toMeters({ x, y }))));
  }

  /** Whether a point (page px) is inside a letter, the bench, the bag or what stands in the open bag. */
  function insideSolid(p: Vec): boolean {
    const loops = [
      ...layout.letters.flatMap((l) => l.loops.map((loop) => loop.map((q): [number, number] => [q.x, q.y]))),
      ...sceneLoops,
      ...scene.openSolids(),
    ];
    let inside = false;
    for (const loop of loops) {
      for (let a = 0, b = loop.length - 1; a < loop.length; b = a++) {
        const [ax, ay] = loop[a];
        const [bx, by] = loop[b];
        if (ay > p.y !== by > p.y && p.x < ((bx - ax) * (p.y - ay)) / (by - ay) + ax) inside = !inside;
      }
    }
    return inside;
  }

  function views(): BallView[] {
    return court.balls.map((b) => ({ id: b.id, ...toScreen(b.x, b.y), r: radiusPx }));
  }

  function canViews(): CanView[] {
    return court.cans.map((c) => ({
      id: c.id,
      ...toScreen(c.x, c.y),
      halfW: (CAN_WIDTH / 2) * pxPerMeter,
      halfH: (CAN_HEIGHT / 2) * pxPerMeter,
      angle: -c.angle,
    }));
  }

  function sprite(b: Ball, alpha: number): BallSprite {
    const at = toScreen(b.prevX + (b.x - b.prevX) * alpha, b.prevY + (b.y - b.prevY) * alpha);
    return { id: b.id, ...at, r: radiusPx, angle: -(b.prevAngle + (b.angle - b.prevAngle) * alpha) };
  }

  /** The cans out of the bag, drawn over the balls. */
  function canSprites(alpha: number): ImageSprite[] {
    const k = pxPerMeter / 1000;
    return court.cans.flatMap((c) => {
      const img = canImages.get(`${c.seed}:${c.ballsLeft}`);
      if (!img?.complete) return [];
      const at = toScreen(c.prevX + (c.x - c.prevX) * alpha, c.prevY + (c.y - c.prevY) * alpha);
      const angle = -(c.prevAngle + (c.angle - c.prevAngle) * alpha);
      return [{ img, ...at, angle, w: CAN_IMAGE.w * k, h: CAN_IMAGE.h * k, ox: CAN_IMAGE.ox * k, oy: CAN_IMAGE.oy * k }];
    });
  }

  /** Each ball's shadow on the bench or the bag under it: smaller and fainter the higher the ball is. */
  function ballShadows(sprites: BallSprite[]): ShadowSprite[] {
    if (!params.ballShadows) return [];
    const out: ShadowSprite[] = [];
    for (const b of sprites) {
      const surface = scene.surfaceBelow(b.x, b.y + b.r);
      if (surface === null) continue;
      const h = surface - b.y;
      const t = Math.max(0, Math.min(1, (h - b.r) / (6 * b.r)));
      const w = 1 - 0.35 * t;
      const fade = Math.max(0, 1 - Math.max(0, h - 7 * b.r) / (12 * b.r));
      out.push({ x: b.x - 0.08 * h, y: surface, rx: b.r * 0.95 * w, ry: b.r * 0.225 * w, alpha: SHADOW_OPACITY * (1 - 0.6 * t) * fade });
    }
    return out;
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

  const gestures = new Gestures(
    views,
    {
      hit(id, dir, at) {
        if (court.cans.some((c) => c.id === id)) return; // a tap on a can does nothing
        noteInteraction();
        court.hit(id, dir.x, -dir.y);
        renderer.burst(at.x, at.y, performance.now());
        sound.play("hit");
        lastHit = { id, dir, at };
      },
      grab(id, at) {
        noteInteraction();
        const p = toMeters(at);
        court.grab(id, p);
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
    },
    canViews,
  );

  /** Keep each "i" dotted: whenever its dot is gone, a fresh ball rises out of the stem. */
  function supply(): void {
    let rising = false;
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
      court.makeRoom();
      home.risingSince = simMs;
      rising = true;
    }
    // One sound, even when the clear button has both dots rising in the same instant.
    if (rising && !restarted) sound.play("rising");
    restarted = false;
  }

  function stepOnce(): void {
    const gone = court.step();
    for (const impact of court.impacts) sound.bounce(impact.speed);
    if (gone.length > 0) sound.play("out");
    // a can that flew out of the screen is back in the bag, full
    for (const seed of court.cansGone) scene.returnCan(seed);
    simMs += STEP * 1000;
    supply();
  }

  /** Sweep every ball off the court and let both dots rise again. The cans go back into the bag, full, and the bag is zipped, with the notebook inside. */
  function reset(): void {
    gestures.cancel();
    canPointer = null;
    finger = null;
    if (notebook.isOpen()) notebook.close();
    for (const ball of [...court.balls]) court.remove(ball.id);
    court.clearCans();
    scene.reset();
    restarted = true;
    for (const home of homes) {
      home.ballId = null;
      home.risingSince = null;
      home.emptySince = simMs - REFILL_DELAY_MS;
    }
  }

  // A hand can put down more than one finger: a thumb resting on the screen, or a second finger that taps another ball.
  // The gestures follow one press at a time, so the finger that began the current one is the only finger they listen
  // to until it lets go. Without that, a second finger would pull a carried ball to where it is, and its lifting would
  // drop the ball the first finger is still holding. (A mouse has no second pointer, and the browser tests steer with
  // events of their own that carry no finger, so only a finger is filtered.)
  let finger: number | null = null;
  const stray = (e: PointerEvent) => e.pointerType === "touch" && finger !== null && e.pointerId !== finger;

  /** The pointer carrying a can taken out of the bag (the gestures carry the cans that are already out). */
  let canPointer: number | null = null;

  /** A press on a can standing in the open bag takes it out and picks it up by that point. */
  function takeCanAt(x: number, y: number): boolean {
    const i = scene.canAt(x, y);
    if (i < 0) return false;
    const pose = scene.takeCan(i);
    const middle = toMeters({ x: pose.x, y: pose.y });
    const can = court.addCan(middle.x, middle.y, (-pose.tilt * Math.PI) / 180, undefined, pose.seed, true);
    const at = toMeters({ x, y });
    court.grab(can.id, at);
    court.carryTo(at.x, at.y);
    noteInteraction();
    return true;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || stray(e)) return;
    const touch = e.pointerType === "touch";
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // a scripted press (browser checks) has no pointer to capture
    }
    if (takeCanAt(e.clientX, e.clientY)) {
      canPointer = e.pointerId;
      if (touch) finger = e.pointerId;
    } else if (gestures.down(e.clientX, e.clientY, gestureClock(e.timeStamp), touch) && touch) {
      finger = e.pointerId;
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (stray(e)) return;
    if (canPointer === e.pointerId) {
      const p = toMeters({ x: e.clientX, y: e.clientY });
      court.carryTo(p.x, p.y);
      return;
    }
    gestures.move(e.clientX, e.clientY);
    if (e.buttons === 0) canvas.style.cursor = hoverCursor(e.clientX, e.clientY);
  });
  /** Let go of a can taken out of the bag. One let go before it is clear of the bag drops back into its place. */
  function endCanCarry(e: PointerEvent): boolean {
    if (canPointer !== e.pointerId) return false;
    canPointer = null;
    const held = court.cans.find((c) => c.held);
    court.release();
    if (held && court.isEmerging(held.id)) {
      court.removeCan(held.id);
      scene.returnCan(held.seed);
    }
    return true;
  }
  canvas.addEventListener("pointerup", (e) => {
    if (stray(e)) return;
    finger = null;
    if (!endCanCarry(e)) gestures.up(gestureClock(e.timeStamp));
  });
  canvas.addEventListener("pointercancel", (e) => {
    if (stray(e)) return;
    finger = null;
    if (!endCanCarry(e)) gestures.cancel();
  });

  function hoverCursor(x: number, y: number): string {
    if (scene.canAt(x, y) >= 0) return "grab";
    for (const can of canViews()) if (canGap(can, { x, y }) <= params.minGrabReachPx) return "grab";
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

  // The sound button only keeps the setting: it shows it, flips between on and off on a click, and stores it for the next visit. Whatever makes a sound reads the same setting from storage
  // (see sound-setting.ts). Its icon and its label both say which it is at.
  let soundLevel = readSound();
  const showSound = () => {
    soundChip.dataset.level = soundLevel;
    const label = `Sound: ${soundLevel}`;
    soundChip.setAttribute("aria-label", label);
    soundChip.title = label;
  };
  soundChip.addEventListener("click", () => {
    soundLevel = nextSound(soundLevel);
    writeSound(soundLevel);
    showSound();
  });
  showSound();

  // The credits open over the toy, which keeps running behind them. A modal dialog brings Escape, focus and a
  // shut-out page with it. With ?tune the sliders have to stay in reach, so there it opens as a plain dialog that
  // sits under them instead, and Escape is handled here.
  creditsChip.addEventListener("click", () => (query.has("tune") ? credits.show() : credits.showModal()));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") credits.close();
  });
  creditsClose.addEventListener("click", () => credits.close());
  // A click on the dimmed toy around the text closes it too. The press has to start out there as well as end
  // there: selecting a name and letting go beside the text is not a click outside.
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

  /** How big the buttons' icons are in this window, and how light. The stylesheet reads both from these properties. */
  function styleControls(): void {
    const root = document.documentElement.style;
    root.setProperty("--icon-size", `${iconSizeFor(renderer.width, renderer.height)}px`);
    root.setProperty("--icon-tone", String(params.iconTone));
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
    // The credits' look and the buttons' tone are only CSS, the trail and the poof are only drawing, the sounds'
    // numbers are read at the moment a sound plays, a finger's reaches at the moment of a press, a can's pour and grip as it
    // is poured and held, and the bag's and the notebook's motion as they move, so changing any of them needs no new court (a
    // new court would stop every ball in the air); every other number does. The buttons' size is CSS too (build sets it for the
    // window), but each button is also a solid disc in the court, so the court is made again to measure them, which is what
    // moving the icon size or share does.
    mountTuner((changed) => {
      if (changed.startsWith("credits")) styleCredits();
      else if (changed === "iconTone") styleControls();
      else if (
        !changed.startsWith("trail") &&
        !changed.startsWith("poof") &&
        !changed.startsWith("sound") &&
        !changed.startsWith("touch") &&
        !changed.startsWith("canPour") &&
        !changed.startsWith("zip") &&
        !changed.startsWith("rise") &&
        !changed.startsWith("sink") &&
        !changed.startsWith("notebook") &&
        changed !== "canGrip" &&
        changed !== "ballShadows"
      )
        build();
    });
  }

  let last = performance.now();
  let pending = 0;
  // A browser check can freeze the real-time loop (`__sandbox.freeze()`): from then on only `advance` moves the court, and taps, holds and
  // carries are timed by the court's own clock, so a slow machine cannot change what a check sees.
  let frozen = false;
  const gestureClock = (real: number) => (frozen ? simMs : real);
  function frame(now: number): void {
    if (!frozen) {
      pending += Math.min(0.1, (now - last) / 1000);
      gestures.tick(now);
      while (pending >= STEP) {
        stepOnce();
        pending -= STEP;
      }
    }
    last = now;
    const alpha = pending / STEP;
    const sprites = court.balls.map((b) => sprite(b, alpha));
    court.balls.forEach((b, i) => {
      if (leavesTrail(b)) renderer.trail(sprites[i], now);
    });
    renderer.draw(now, sprites, risingSprites(), ballShadows(sprites), canSprites(alpha));
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
      /** The bag: how far its zip has run (0 to 1), whether it is open, whether the notebook is out, and where the pull is, page px. */
      bag: () => ({ zip: scene.zip, open: scene.open, notebookOut: scene.notebookOut, pull: scene.pullPoint() }),
      /** The scene's layout: where the bench, the bag and the rest stand, page px. */
      scene: () => scene.layout,
      /** Where the pull would be at a given progress along the zip (0 to 1), page px. */
      zipPoint: (zip: number) => scene.zipPoint(zip),
      /** The notebook: whether it lies open over the toy, and the size of its type (px) and whether all its words are on the pages. */
      notebook: () => ({ open: notebook.isOpen(), ...notebook.type() }),
      /** The cans that are out of the bag, each with the balls it still holds. */
      cans: () =>
        court.cans.map((c) => ({
          id: c.id,
          seed: c.seed,
          ...toScreen(c.x, c.y),
          angle: -c.angle,
          vx: c.vx * pxPerMeter,
          vy: -c.vy * pxPerMeter,
          held: c.held,
          ballsLeft: c.ballsLeft,
          width: CAN_WIDTH * pxPerMeter,
          height: CAN_HEIGHT * pxPerMeter,
        })),
      lastHit: () => lastHit,
      effects: () => renderer.effects(),
      pxPerMeter: () => pxPerMeter,
      /** Let a loose ball go at a point on screen (px). */
      drop(x: number, y: number) {
        const at = toMeters({ x, y });
        return court.addBall(at.x, at.y, false).id;
      },
      /** Run the simulation forward without waiting for frames. */
      advance(seconds: number) {
        for (let i = 0; i < Math.round(seconds / STEP); i++) {
          stepOnce();
          if (frozen) gestures.tick(simMs);
        }
      },
      /** Stop the real-time loop: the court then moves only when `advance` is called, and presses are timed by the court's clock. */
      freeze() {
        frozen = true;
        pending = 0;
      },
    },
  });
}

main();
