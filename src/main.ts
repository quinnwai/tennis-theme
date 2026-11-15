import type { Fixture } from "planck";
import { alongOf, notebookSolid, pullAt, ZIP_OPEN } from "./bag";
import { CAN_COUNT, CAN_HEIGHT, CAN_WIDTH } from "./cans";
import { floorLiftFor, iconSizeFor } from "./controls";
import { flightPoint, layoutFurniture, solidsOf, type Furniture } from "./furniture";
import { densify } from "./geometry";
import { Gestures, canGap, type BallView, type CanView, type Vec } from "./input";
import { startMeasuring } from "./measure";
import { NOTEBOOK_PARAGRAPHS } from "./notebook-text";
import { wireOverlay } from "./overlay";
import { readPalette } from "./palette";
import { params } from "./params";
import { Court, STEP, type Ball } from "./physics";
import { Renderer, type BallSprite } from "./render";
import { Scenery, type CanSprite } from "./scenery";
import { Sound, browserEnv, wakeOnGesture } from "./sound";
import { readSound, writeSound } from "./sound-setting";
import { leavesTrail } from "./trail";
import { mountTuner } from "./tune";
import { layoutName, type NameLayout } from "./wordmark";
import { WORDMARKS } from "./wordmark.data";

const REFILL_DELAY_MS = 1200; // longer than a tapped ball takes to go straight up and come back down
const RISE_MS = 260; // how long a fresh ball takes to rise out of the stem

// What happens when the bag is unzipped, in milliseconds after it opens: the notebook comes up out of it, and the three cans each
// come up out of it and land on their spots (the first sets off a moment after the notebook starts, and the others follow at an
// interval). All judged by eye.
const NOTEBOOK_MS = 350;
const CAN_FIRST_MS = 150;
const CAN_STAGGER_MS = 120;
const CAN_FLIGHT_MS = 420;

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
  const notebookButton = document.querySelector<HTMLButtonElement>(".notebook")!;
  const notebook = document.querySelector<HTMLDialogElement>(".notebook-overlay")!;
  const notebookBook = notebook.querySelector<HTMLElement>(".notebook-book")!;
  const notebookPage = notebook.querySelector<HTMLElement>(".notebook-page")!;
  const notebookClose = notebook.querySelector<HTMLButtonElement>(".close")!;
  for (const text of NOTEBOOK_PARAGRAPHS) notebookPage.append(Object.assign(document.createElement("p"), { textContent: text }));

  // Sounds answer what the visitor does, so they only play once the visitor has done something (see sound.ts).
  const sound = new Sound(browserEnv());
  wakeOnGesture(sound, window);

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

  // The bench and the bag stand on the right. The bag opens when its zip's pull is dragged to the end (`pull` is how far along it is, 0 to
  // 1); then the notebook comes up out of it and the cans come out one after another (`cansOut` have landed so far). Restart zips it again.
  const scenery = new Scenery(palette);
  renderer.setProps(scenery);
  let furniture!: Furniture;
  const bag = { pull: 0, open: false, openedAt: 0, cansOut: 0 };
  let notebookSolidShape: Fixture | null = null;
  /** The pull being dragged: the zip is under a finger or the mouse, and how far from the pull's middle the press was, along the zip. */
  const zip = { dragging: false, offset: 0 };

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
    // Cans keep their place the same way, and keep their balls.
    const cansBefore = court
      ? court.cans.map((c) => {
          const s = toScreen(c.x, c.y);
          return { x: (s.x - layout.origin.x) / layout.emPx, y: (layout.origin.y - s.y) / layout.emPx, angle: c.angle, balls: c.ballsLeft };
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
    // The bench, the bag and the cans' spots keep clear of the corner buttons and of the name, which is what these two are for.
    const buttons = [toggle, creditsChip, clearButton, soundChip].map((chip) => {
      const box = chip.getBoundingClientRect();
      const [low, high] = [toMeters({ x: box.left, y: box.bottom }), toMeters({ x: box.right, y: box.top })];
      return { left: low.x, bottom: low.y, right: high.x, top: high.y };
    });
    furniture = layoutFurniture(width, { avoid: buttons, ink: outlines.flatMap((loop) => densify(loop.map(toMeters), 0.01)), floor });
    court = new Court(
      width,
      height,
      outlines.map((loop) => loop.map(toMeters)),
      pegs,
      floor,
      solidsOf(furniture),
    );
    notebookSolidShape = notebookIsOut() ? court.addSolid(notebookSolid(furniture.bag)) : null;
    scenery.setLayout(furniture, pxPerMeter, renderer.height);
    placeNotebook();

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
      court.addCan(Math.min(width - CAN_WIDTH, Math.max(CAN_WIDTH, at.x)), Math.max(CAN_HEIGHT / 2 + floor, at.y), c.angle, c.balls);
    }
  }

  /** Whether the notebook stands out of the bag, which it does from a moment after the bag opens until restart. */
  function notebookIsOut(): boolean {
    return bag.open && simMs - bag.openedAt >= NOTEBOOK_MS;
  }

  /**
   * Lay the notebook's button over the part of the notebook that shows, and show it once the notebook is out. In a short window only a
   * few cm of it show, which is too little to tap, so the button is never less than 44 px tall (what a fingertip needs, as for the
   * corner buttons) and takes the rest from the top of the bag below, which is where the notebook goes on into the bag anyway.
   */
  function placeNotebook(): void {
    const shown = furniture.bag.notebookShown;
    const top = toScreen(shown.left, shown.top);
    notebookButton.style.left = `${top.x}px`;
    notebookButton.style.top = `${top.y}px`;
    notebookButton.style.width = `${(shown.right - shown.left) * pxPerMeter}px`;
    notebookButton.style.height = `${Math.max(44, (shown.top - shown.bottom) * pxPerMeter)}px`;
    notebookButton.hidden = !notebookIsOut();
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

  /**
   * The cans as they are drawn: those that are out, and those still on their way. A can that has been let out of the bag sets off
   * from its top, goes up and over in an arc, and comes down on its spot; it is drawn behind the bag for the first part of the way, so
   * that it seems to come up out of it. Until its turn it is not drawn: it is inside.
   */
  function canSprites(alpha: number): CanSprite[] {
    const sprites = court.cans.map((c): CanSprite => {
      const at = toScreen(c.prevX + (c.x - c.prevX) * alpha, c.prevY + (c.y - c.prevY) * alpha);
      return { ...at, angle: -(c.prevAngle + (c.angle - c.prevAngle) * alpha), balls: c.ballsLeft, inBag: false };
    });
    if (!bag.open) return sprites;
    for (let i = bag.cansOut; i < CAN_COUNT; i++) {
      const t = (simMs - bag.openedAt - CAN_FIRST_MS - i * CAN_STAGGER_MS) / CAN_FLIGHT_MS;
      if (t <= 0) continue;
      const at = flightPoint(furniture, i, Math.min(1, t));
      sprites.push({ ...toScreen(at.x, at.y), angle: 0, balls: 3, inBag: t < 0.3 });
    }
    return sprites;
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
  const gestures = new Gestures(
    views,
    {
      hit(id, dir, at) {
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
    if (rising) sound.play("rising");
  }

  function stepOnce(): void {
    const gone = court.step();
    for (const impact of court.impacts) sound.bounce(impact.speed);
    if (gone.length > 0) sound.play("out");
    simMs += STEP * 1000;
    supply();
    advanceBag();
  }

  /** Once the bag is open: put each can down on its spot as it lands, and stand the notebook's solid shape in the court once it is up. */
  function advanceBag(): void {
    if (!bag.open) return;
    const elapsed = simMs - bag.openedAt;
    while (bag.cansOut < CAN_COUNT && elapsed >= CAN_FIRST_MS + bag.cansOut * CAN_STAGGER_MS + CAN_FLIGHT_MS) {
      const spot = furniture.spots[bag.cansOut++];
      court.addCan(spot.x, spot.y);
    }
    if (!notebookSolidShape && notebookIsOut()) {
      notebookSolidShape = court.addSolid(notebookSolid(furniture.bag));
      placeNotebook();
    }
  }

  /** The bag's pull has reached the end of the zip. The bag opens: a pop, and then the notebook and the cans come out. */
  function openBag(): void {
    bag.pull = 1;
    bag.open = true;
    bag.openedAt = simMs;
    bag.cansOut = 0;
    zip.dragging = false;
    sound.play("rising");
  }

  /** Sweep every ball off the court and let both dots rise again. The cans go back into the bag, full, and the bag is zipped, with the notebook inside. */
  function reset(): void {
    gestures.cancel();
    zip.dragging = false;
    for (const ball of [...court.balls]) court.remove(ball.id);
    court.clearCans();
    if (notebookSolidShape) court.removeSolid(notebookSolidShape);
    notebookSolidShape = null;
    Object.assign(bag, { pull: 0, open: false, openedAt: 0, cansOut: 0 });
    notebookOverlay.close();
    placeNotebook();
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

  // The bag's zip is dragged by its pull, which sits at the start of the zip, and nothing else opens the bag: a click or a tap on the bag, or
  // on the pull without moving it, does nothing. The pull is a small thing, so it is taken from as far away as a hold of a ball would be
  // (more for a finger), and it is taken before a ball that happens to lie near it.
  function pullPoint(): Vec {
    const at = pullAt(furniture.bag, bag.pull);
    return toScreen(at.x, at.y - 0.02); // the middle of the tab that hangs under the zip
  }
  function startsZip(e: PointerEvent): boolean {
    if (bag.open) return false;
    const pull = pullPoint();
    const reach = e.pointerType === "touch" ? params.touchMinHitReachPx : params.minHitReachPx;
    if (Math.hypot(e.clientX - pull.x, e.clientY - pull.y) > reach) return false;
    zip.dragging = true;
    zip.offset = pull.x - e.clientX;
    return true;
  }
  function dragZip(x: number): void {
    const before = bag.pull;
    bag.pull = alongOf(furniture.bag, (x + zip.offset) / pxPerMeter);
    if (bag.pull !== before) noteInteraction();
    if (bag.pull >= ZIP_OPEN) openBag();
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || stray(e)) return;
    const touch = e.pointerType === "touch";
    if (startsZip(e)) {
      if (touch) finger = e.pointerId;
    } else if (gestures.down(e.clientX, e.clientY, e.timeStamp, touch) && touch) {
      finger = e.pointerId;
    }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (stray(e)) return;
    if (zip.dragging) {
      dragZip(e.clientX);
      return;
    }
    gestures.move(e.clientX, e.clientY);
    if (e.buttons === 0) canvas.style.cursor = hoverCursor(e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (stray(e)) return;
    finger = null;
    if (zip.dragging) zip.dragging = false;
    else gestures.up(e.timeStamp);
  });
  canvas.addEventListener("pointercancel", (e) => {
    if (stray(e)) return;
    finger = null;
    if (zip.dragging) zip.dragging = false;
    else gestures.cancel();
  });

  function hoverCursor(x: number, y: number): string {
    if (!bag.open) {
      const pull = pullPoint();
      if (Math.hypot(x - pull.x, y - pull.y) <= params.minHitReachPx) return "grab";
    }
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

  // The sound toggle only keeps the setting: it shows it, flips it on a click, and stores it for the next visit.
  // Whatever makes a sound reads the same setting from storage (see sound-setting.ts).
  let soundOn = readSound() === "on";
  const showSound = () => soundChip.setAttribute("aria-checked", String(soundOn));
  soundChip.addEventListener("click", () => {
    soundOn = !soundOn;
    writeSound(soundOn ? "on" : "off");
    showSound();
  });
  showSound();

  // The credits open over the toy, which keeps running behind them, and so does the notebook's page (see overlay.ts for how a dialog closes).
  // Clicking the notebook, like picking up a can or dragging the zip, is playing with the toy, and counts for the analytics.
  const creditsOverlay = wireOverlay(credits, creditsText, creditsClose, query.has("tune"));
  creditsChip.addEventListener("click", creditsOverlay.open);
  const notebookOverlay = wireOverlay(notebook, notebookBook, notebookClose, query.has("tune"));
  notebookButton.addEventListener("click", () => {
    noteInteraction();
    notebookOverlay.open();
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
    // numbers are read at the moment a sound plays, a finger's reaches at the moment of a press and a can's pour and grip as it
    // is poured and held, so changing any of them needs no new court (a new court would stop every ball in the air); every other
    // number does. The buttons' size is CSS too (build sets it for the window), but each button is also a solid disc in the court,
    // so the court is made again to measure them, which is what moving the icon size or share does.
    mountTuner((changed) => {
      if (changed.startsWith("credits")) styleCredits();
      else if (changed === "iconTone") styleControls();
      else if (
        !changed.startsWith("trail") &&
        !changed.startsWith("poof") &&
        !changed.startsWith("sound") &&
        !changed.startsWith("touch") &&
        !changed.startsWith("canPour") &&
        changed !== "canGrip"
      )
        build();
    });
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
    scenery.pull = bag.pull;
    scenery.noteRise = bag.open ? Math.min(1, (simMs - bag.openedAt) / NOTEBOOK_MS) : 0;
    scenery.cans = canSprites(alpha);
    const sprites = court.balls.map((b) => sprite(b, alpha));
    court.balls.forEach((b, i) => {
      if (leavesTrail(b)) renderer.trail(sprites[i], now);
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
      /** The bag: how far its pull has been dragged along the zip (0 to 1), and whether it is open. */
      bag: () => ({ open: bag.open, pull: bag.pull }),
      /** The notebook: whether it stands out of the bag, and whether its page is open. */
      notebook: () => ({ out: notebookIsOut(), open: notebook.open }),
      /** The cans that are out, each with the balls it still holds. */
      cans: () =>
        court.cans.map((c) => ({
          id: c.id,
          ...toScreen(c.x, c.y),
          angle: -c.angle,
          vx: c.vx * pxPerMeter,
          vy: -c.vy * pxPerMeter,
          held: c.held,
          ballsLeft: c.ballsLeft,
          width: CAN_WIDTH * pxPerMeter,
          height: CAN_HEIGHT * pxPerMeter,
        })),
      /** Where the furniture stands, as boxes in px with y down, and where the pull and the cans' spots are. */
      scenery: () => {
        const box = (r: { left: number; bottom: number; right: number; top: number }) => {
          const a = toScreen(r.left, r.top);
          const b = toScreen(r.right, r.bottom);
          return { left: a.x, top: a.y, right: b.x, bottom: b.y };
        };
        const bounds = (points: { x: number; y: number }[]) =>
          box({
            left: Math.min(...points.map((p) => p.x)),
            right: Math.max(...points.map((p) => p.x)),
            bottom: Math.min(...points.map((p) => p.y)),
            top: Math.max(...points.map((p) => p.y)),
          });
        const { bench, bag: sack, spots } = furniture;
        return {
          seat: bounds(bench.seat),
          legs: bench.legs.map(bounds),
          bag: bounds(sack.body),
          zip: { x0: toScreen(sack.zip.x0, sack.zip.y).x, x1: toScreen(sack.zip.x1, sack.zip.y).x, y: toScreen(0, sack.zip.y).y },
          pull: pullPoint(),
          notebook: box(sack.notebookShown),
          spots: spots.map((p) => toScreen(p.x, p.y)),
        };
      },
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
