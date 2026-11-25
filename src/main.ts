import { floorLiftFor, iconSizeFor } from "./controls";
import { Gestures, canGap, type BallView, type CanView, type Vec } from "./input";
import { CanHand, type CanTarget } from "./can-hand";
import { Confetti, flash } from "./celebrate";
import { CAN_BALLS, CAN_HEIGHT, CAN_WIDTH } from "./cans";
import { startMeasuring } from "./measure";
import { readPalette } from "./palette";
import { params } from "./params";
import { Court, STEP, type Ball, type Can, type Entry } from "./physics";
import { Renderer, type BallSprite, type Ghost, type ImageSprite, type ShadowSprite } from "./render";
import { Sound, browserEnv, wakeOnGesture } from "./sound";
import { nextSound, readSound, writeSound } from "./sound-setting";
import { leavesTrail } from "./trail";
import { DESCENT_MS, TROPHY_ART, TROPHY_URL, glintAt, keepTrophyIn, trophyAnchor, trophyFit } from "./trophy";
import { mountTuner } from "./tune";
import { CAN_IMAGE, SHADOW, SHADOW_OPACITY, SKEW, canImage } from "./v6/art";
import { mountNotebook, type Notebook } from "./v6/notebook";
import { Match } from "./v6/match";
import { Scene } from "./v6/scene";
import { mountScoreboard, type Scoreboard } from "./v6/scoreboard";
import { mountRulesCard } from "./v6/rules-card";
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

  /** The cans game, found by emptying a can: its match and its scoreboard. Nothing of it shows until then. */
  const game: { match: Match; board: Scoreboard } = { match: new Match(), board: mountScoreboard() };
  /** How to play: a card tucked behind the scoreboard, there only once the game is found. */
  const rules = mountRulesCard(document.querySelector<HTMLElement>(".v6-score")!);
  /** How the match is going, for the stats card: since the game was found (sim ms), and when the stats are due after the win (0: not due). */
  let tally = { thrown: 0, inCans: 0, since: 0, wonAt: 0 };
  /**
   * The win's celebration, on the court's clock: the confetti falls; once half of it has passed, the trophy comes down (the first win only)
   * and the glint is due 1.6 s on, when it would have settled; then the stats drop down. `glintDue` is 0 until half the confetti has passed.
   */
  let celebration: { glintDue: number; half: boolean } | null = null;
  let shower: Confetti | null = null;
  /** The trophy, once it has been won: kept through Play again and Restart, never past leaving the page. `rest` is where its foot floats. */
  let trophy: { rest: Vec; scale: number; since: number } | null = null;
  const trophyImg = document.createElement("img");
  trophyImg.className = "trophy";
  trophyImg.alt = "";
  trophyImg.setAttribute("aria-hidden", "true");
  trophyImg.src = TROPHY_URL;
  trophyImg.hidden = true;
  document.body.append(trophyImg);
  /** What the celebration did and when, for the browser checks: the court's time in seconds, and where a glint is. */
  const celebrationLog: { event: string; t: number; x?: number; y?: number }[] = [];
  const logEvent = (event: string, at?: Vec) => celebrationLog.push({ event, t: simMs / 1000, ...at });
  /** How the last ball into a can was judged, and the crowd's sounds started so far (none with the sound off), for the browser checks. */
  let lastEntry: Entry | null = null;
  const heard: string[] = [];

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
    // Cans out of the bag keep their place the same way, and keep their balls. One in the middle of a pour or a wiggle goes back to where
    // it started, and one that was out of the bag only for the moment goes back in it.
    const cansBefore = court
      ? court.cans.map((c) => {
          const home = court.homeOf(c.id) ?? { x: c.x, y: c.y, a: c.angle };
          const s = toScreen(home.x, home.y);
          return {
            x: (s.x - layout.origin.x) / layout.emPx,
            y: (layout.origin.y - s.y) / layout.emPx,
            angle: Math.atan2(Math.sin(home.a), Math.cos(home.a)),
            balls: c.ballsLeft,
            seed: c.seed,
            toBag: court.fromBag(c.id),
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
    court.onBackInBag = (can) => putBack(can.seed, can.ballsLeft, can.id);
    court.onCanEntry = (_can, _ball, entry) => judged(entry);
    court.onBagEntry = bagEntry;

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
      if (c.toBag) {
        putBack(c.seed, c.balls);
        continue;
      }
      const at = toMeters({ x: layout.origin.x + c.x * layout.emPx, y: layout.origin.y - c.y * layout.emPx });
      court.addCan(Math.min(width - CAN_WIDTH, Math.max(CAN_WIDTH, at.x)), Math.max(CAN_HEIGHT / 2 + floor, at.y), c.angle, c.balls, c.seed);
    }
    fitTrophy();
  }

  /** What stands in the open bag, as solids in the court. Page px in. */
  function applySceneSolids(loops: [number, number][][]): void {
    court?.setSolids(loops.map((loop) => loop.map(([x, y]) => toMeters({ x, y }))));
    updateBagMouths();
  }

  /** The cans standing in the open bag take balls too, while they have room. */
  function updateBagMouths(): void {
    if (!court) return;
    court.bagMouths = scene.canMouths().map((m) => {
      const at = toMeters(m);
      const t = (m.tilt * Math.PI) / 180;
      return {
        seed: m.seed,
        room: CAN_BALLS - (bagBalls.get(m.seed) ?? CAN_BALLS),
        mouth: { x: at.x, y: at.y, ux: Math.sin(t), uy: Math.cos(t), half: m.width / 2 / pxPerMeter },
      };
    });
  }

  /** A ball went into a can standing in the open bag. */
  function bagEntry(seed: number, _ball: Ball, entry: Entry): void {
    const balls = (bagBalls.get(seed) ?? CAN_BALLS) + 1;
    bagBalls.set(seed, balls);
    scene.setCanBalls(seed, balls);
    updateBagMouths();
    judged(entry);
  }

  /** A ball went into a can, judged `entry`: once the game is found, a throw that counts wins a point, to applause. */
  function judged(entry: Entry): void {
    lastEntry = entry;
    if (game.match.found) tally.inCans += 1;
    if (game.match.found && entry === "point") scorePoint();
  }

  /** A counted throw: you win a point, to applause, and the score flashes. The third wins the match, and the stats follow. */
  function scorePoint(): void {
    const result = game.match.point();
    if (result === "over") return;
    game.board.update(game.match, true);
    if (readSound() === "on") heard.push("applause");
    sound.play("applause");
    if (result === "won") {
      tally.wonAt = simMs;
      celebrate();
    }
  }

  /** The match is won: the cheer, and confetti over the window. The rest follows from `stepCelebration`. */
  function celebrate(): void {
    logEvent("won");
    if (readSound() === "on") heard.push("cheer");
    sound.preload("cheer");
    sound.play("cheer");
    shower?.remove();
    shower = reducedMotion ? null : new Confetti(renderer.width, renderer.height);
    celebration = { glintDue: 0, half: false };
  }

  /** Where the trophy floats here, and how big (px per mm as drawn). */
  function fitTrophy(): void {
    if (!trophy) return;
    const k = pxPerMeter / 1000;
    const nameTop = Math.min(...layout.letters.flatMap((l) => l.loops.flat().map((p) => p.y)));
    const fit = trophyFit(k, nameTop, renderer.width, renderer.height);
    trophy.scale = fit.scale;
    trophy.rest = keepTrophyIn(fit.rest, k * fit.scale, renderer.width, renderer.height);
  }

  /** Where the middle of the trophy's foot is now, and its px per mm as drawn. */
  const trophyAt = () => ({ at: trophyAnchor(trophy!.rest, simMs - trophy!.since, reducedMotion), k: (pxPerMeter / 1000) * trophy!.scale });

  function drawTrophy(): void {
    trophyImg.hidden = !trophy;
    if (!trophy) return;
    const { at, k } = trophyAt();
    Object.assign(trophyImg.style, {
      width: `${TROPHY_ART.w * k}px`,
      height: `${TROPHY_ART.h * k}px`,
      transform: `translate(${at.x - TROPHY_ART.ox * k}px, ${at.y - TROPHY_ART.oy * k}px)`,
    });
  }

  /**
   * One step of the win: the confetti falls; once half of it has passed the trophy comes down (a later win brings none: the one already
   * won stays where it is); 1.6 s on, when a new one would have settled, a glint plays on its rim, and then the stats drop down.
   */
  function stepCelebration(): void {
    if (shower) {
      if (Math.round(simMs / (1000 * STEP)) % 4 === 0) shower.step(STEP * 4);
      if (shower.done()) {
        shower.remove();
        shower = null;
      }
    }
    const c = celebration;
    if (!c) return;
    if (!c.half && (!shower || shower.halfPassed())) {
      c.half = true;
      logEvent("confetti-half");
      if (!trophy) {
        trophy = { rest: { x: renderer.width / 2, y: 0 }, scale: 1, since: simMs };
        fitTrophy();
        logEvent("trophy-in");
      }
      c.glintDue = simMs + (reducedMotion ? 0 : DESCENT_MS);
    }
    if (c.half && simMs >= c.glintDue) {
      celebration = null;
      logEvent("trophy-settled");
      const { at, k } = trophyAt();
      const rim = glintAt(at, k);
      flash(rim.x, rim.y, 120 * k);
      logEvent("glint", rim);
      rules.hide();
      game.board.showStats(
        {
          thrown: Math.max(tally.thrown, game.match.pointsWon),
          inCans: tally.inCans,
          points: game.match.pointsWon,
          streak: game.match.pointsWon,
          ms: tally.wonAt - tally.since,
        },
        playAgain,
      );
      logEvent("stats");
    }
  }

  /** A new match from the stats: back to 15-30 with the board and How to play up. Everything on the court stays where it is. */
  function playAgain(): void {
    game.match.playAgain();
    game.board.show(game.match);
    rules.show();
    tally = { thrown: 0, inCans: 0, since: simMs, wonAt: 0 };
    celebration = null;
    lastEntry = null;
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
    return court.cans.flatMap((c) => {
      const k = (pxPerMeter / 1000) * c.scale;
      const img = canImages.get(`${c.seed}:${c.ballsLeft}`);
      if (!img?.complete) return [];
      const at = toScreen(c.prevX + (c.x - c.prevX) * alpha, c.prevY + (c.y - c.prevY) * alpha);
      const angle = -(c.prevAngle + (c.angle - c.prevAngle) * alpha);
      // a can on its way out of the bag, or lifted out to pour and going back, is behind the bag's front
      const behind = court.fromBag(c.id) ? scene.frontFace() : undefined;
      return [{ img, ...at, angle, w: CAN_IMAGE.w * k, h: CAN_IMAGE.h * k, ox: CAN_IMAGE.ox * k, oy: CAN_IMAGE.oy * k, behind }];
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
        noteInteraction();
        if (game.match.found) tally.thrown += 1;
        court.hit(id, dir.x, -dir.y);
        renderer.burst(at.x, at.y, clock(performance.now()));
        sound.play("hit");
        lastHit = { id, dir, at };
      },
      grab(id, at) {
        noteInteraction();
        const p = toMeters(at);
        court.grab(id);
        court.carryTo(p.x, p.y);
      },
      carry(at) {
        noteInteraction();
        const p = toMeters(at);
        court.carryTo(p.x, p.y);
      },
      release() {
        noteInteraction();
        const held = court.balls.find((b) => b.held);
        court.release();
        // let go while moving, it was thrown
        if (game.match.found && held && Math.hypot(held.vx, held.vy) > 0.8) tally.thrown += 1;
      },
    },
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
    // the game is found the moment a can is emptied
    if (!game.match.found && court.cans.some((c) => c.ballsLeft === 0)) {
      game.match.found = true;
      sound.preload("cheer");
      game.board.show(game.match);
      rules.show();
      tally = { thrown: 0, inCans: 0, since: simMs, wonAt: 0 };
    }
    stepCelebration();
  }

  /** Sweep every ball off the court and let both dots rise again. The cans go back into the bag, full, and the bag is zipped, with the notebook inside. */
  function reset(): void {
    gestures.cancel();
    canHand.cancel();
    finger = null;
    if (notebook.isOpen()) notebook.close();
    for (const ball of [...court.balls]) court.remove(ball.id);
    court.clearCans();
    scene.reset();
    // the cans in the bag are full again
    bagBalls.clear();
    game.match.reset();
    game.board.hide();
    rules.hide();
    celebration = null; // the trophy stays, and the confetti already in the air finishes falling
    lastEntry = null;
    for (const seed of [1, 2, 3]) scene.setCanBalls(seed, CAN_BALLS);
    restarted = true;
    for (const home of homes) {
      home.ballId = null;
      home.risingSince = null;
      home.emptySince = simMs - REFILL_DELAY_MS;
    }
  }

  // A hand can put down more than one finger: a thumb resting on the screen, or a second finger that taps another ball. The ball
  // gestures follow one press at a time, so the finger that began the current one is the only finger they listen to until it lets
  // go. Without that, a second finger would pull a carried ball to where it is, and its lifting would drop the ball the first finger is
  // still holding. A can is the other hand's: one finger can carry a can while another throws a ball. (A mouse has no second pointer,
  // and the browser tests steer with events of their own that carry no finger, so only a finger is filtered.)
  let finger: number | null = null;
  const stray = (e: PointerEvent) => e.pointerType === "touch" && finger !== null && e.pointerId !== finger;

  /** How many balls each can standing in the bag holds, by which can it is: three until it has been poured. */
  const bagBalls = new Map<number, number>();

  /** A can goes back to its place in the open bag, holding `balls` (`canId`: the can out of the bag it was). */
  function putBack(seed: number, balls: number, canId?: number): void {
    if (canId !== undefined) court.removeCan(canId);
    bagBalls.set(seed, balls);
    scene.setCanBalls(seed, balls);
    scene.returnCan(seed);
    updateBagMouths();
  }

  /** Take a can standing in the open bag out of it, as a can in the court where it stood. `pour`: only to pour or wiggle it, at the bag's size, standing still until the tap starts it. */
  function outOfBag(index: number, pour: boolean): Can {
    const pose = scene.takeCan(index);
    const at = toMeters({ x: pose.x, y: pose.y });
    return court.addCan(at.x, at.y, (-pose.tilt * Math.PI) / 180, bagBalls.get(pose.seed) ?? CAN_BALLS, pose.seed, true, {
      scale: pour ? scene.layout.scale : 1,
      state: "placed",
    });
  }

  /** What a press at a point (page px) lands on among the cans: the nearest one within reach of its outline, else one standing in the open bag. */
  function pickCan(at: Vec): CanTarget | null {
    let best: CanView | undefined;
    let bestGap = Infinity;
    for (const can of canViews()) {
      const gap = canGap(can, at);
      if (gap <= params.canReachPx && gap <= bestGap) {
        best = can;
        bestGap = gap;
      }
    }
    if (best) return { kind: "can", id: best.id };
    const index = scene.canAt(at.x, at.y);
    return index >= 0 ? { kind: "bag", index } : null;
  }

  /** Whether a ball is within reach of a press, which then belongs to the ball: balls are looked for before cans. */
  function ballAt(at: Vec): boolean {
    return views().some((b) => Math.hypot(b.x - at.x, b.y - at.y) < b.r + params.canBallReachPx);
  }

  const canHand = new CanHand({
    tap(target) {
      noteInteraction();
      if (target.kind === "can") court.tapCan(target.id);
      else {
        const can = outOfBag(target.index, true);
        if (!court.tapCan(can.id, true)) putBack(can.seed, can.ballsLeft, can.id);
      }
    },
    grab(target, from, at) {
      noteInteraction();
      const id = target.kind === "can" ? target.id : outOfBag(target.index, false).id;
      if (!court.grabCan(id, toMeters(from))) return null;
      court.carryCan(id, toMeters(at));
      return id;
    },
    move(id, at) {
      court.carryCan(id, toMeters(at));
    },
    drop(id) {
      noteInteraction();
      const held = court.cans.find((c) => c.id === id);
      court.releaseCan(id);
      // let go before it was clear of the bag, it drops back into its place
      if (held && court.isEmerging(id)) putBack(held.seed, held.ballsLeft, id);
    },
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const at = { x: e.clientX, y: e.clientY };
    const touch = e.pointerType === "touch";
    const target = ballAt(at) ? null : pickCan(at);
    if (target) {
      if (!canHand.free) return;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // a scripted press (browser checks) has no pointer to capture
      }
      canHand.down(e.pointerId, target, at, clock(e.timeStamp));
      return;
    }
    if (stray(e)) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // a scripted press (browser checks) has no pointer to capture
    }
    if (gestures.down(e.clientX, e.clientY, clock(e.timeStamp), touch) && touch) finger = e.pointerId;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (canHand.has(e.pointerId)) {
      canHand.move(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    if (stray(e)) return;
    gestures.move(e.clientX, e.clientY);
    if (e.buttons === 0) canvas.style.cursor = hoverCursor(e.clientX, e.clientY);
  });
  const endCanPress = (e: PointerEvent, cancelled: boolean): boolean => {
    if (!canHand.has(e.pointerId)) return false;
    if (cancelled) canHand.cancel();
    else canHand.up(e.pointerId, clock(e.timeStamp));
    return true;
  };
  canvas.addEventListener("pointerup", (e) => {
    if (endCanPress(e, false)) return;
    if (stray(e)) return;
    finger = null;
    gestures.up(clock(e.timeStamp));
  });
  canvas.addEventListener("pointercancel", (e) => {
    if (endCanPress(e, true)) return;
    if (stray(e)) return;
    finger = null;
    gestures.cancel();
  });

  function hoverCursor(x: number, y: number): string {
    if (scene.canAt(x, y) >= 0) return "grab";
    for (const can of canViews()) if (canGap(can, { x, y }) <= params.canReachPx) return "grab";
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
      canHand.cancel(); // what is carried is let go first (it lands in the new layout), so no press is left holding a stale can
      build();
    }, 150);
  });

  styleCredits();
  build();
  if (query.has("tune")) {
    // The credits' look and the buttons' tone are only CSS, the trail and the poof are only drawing, the sounds'
    // numbers are read at the moment a sound plays, a finger's and a can's reaches at the moment of a press, and the bag's and the notebook's motion as they move, so changing any of them needs no new court (a
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
        !changed.startsWith("canTap") &&
        changed !== "canBallReachPx" &&
        changed !== "canReachPx" &&
        !changed.startsWith("zip") &&
        !changed.startsWith("rise") &&
        !changed.startsWith("sink") &&
        !changed.startsWith("notebook") &&
        changed !== "ballShadows"
      )
        build();
    });
  }

  // The drop preview: while a can is carried, a shadow shows where it would come to rest if it were let go now. Where that is can change a
  // lot from one moment to the next (onto the other side of a ball, off the edge of a letter), so the shadow is drawn calmly: it glides
  // after the place, fades while the can is swung fast, and fades out and back in rather than leaping. Held still, it sits on the place.
  const GHOST_CLEAR = 0.45; // m/s: fully shown below this, not at all above GHOST_GONE
  const GHOST_GONE = 1.4;
  const shown = new Map<number, Ghost>();
  let ghostClock = 0;
  /** What the last frame drew, for the browser checks. */
  let drawnGhosts: Ghost[] = [];
  function ghosts(now: number, frozenNow: boolean): Ghost[] {
    // a stalled real frame is not let to jump the glide; a frozen court's clock moves only when a check says, so it runs whole
    const dt = Math.max(0, (now - ghostClock) / 1000);
    ghostClock = now;
    const step = frozenNow ? dt : Math.min(0.05, dt);
    const out: Ghost[] = [];
    for (const c of court.cans) {
      const rest = c.held ? court.restOf(c.id) : null;
      if (!rest) {
        shown.delete(c.id);
        continue;
      }
      const target = { id: c.id, ...toScreen(rest.x, rest.y), angle: -rest.a, w: CAN_WIDTH * pxPerMeter * c.scale, h: CAN_HEIGHT * pxPerMeter * c.scale, alpha: 1 };
      const speed = Math.hypot(c.vx, c.vy);
      const visible = Math.max(0, Math.min(1, 1 - (speed - GHOST_CLEAR) / (GHOST_GONE - GHOST_CLEAR)));
      let s = shown.get(c.id);
      if (!s) shown.set(c.id, (s = { ...target, alpha: 0 }));
      // a long stretch of a frozen court's time (a check's `advance`) is taken in frame-sized steps, so fading out, jumping and fading in
      // all happen as they would have frame by frame
      const steps = Math.max(1, Math.ceil(step * 60));
      for (let n = 0; n < steps; n++) {
        const dt = step / steps;
        // a can's outline is the same turned half way round, so its turns are compared that way
        const turn = Math.atan2(Math.sin(2 * (target.angle - s.angle)), Math.cos(2 * (target.angle - s.angle))) / 2;
        const far = Math.hypot(target.x - s.x, target.y - s.y) > target.h * 0.45 || Math.abs(turn) > 0.6;
        if (far) {
          // somewhere else entirely: fade out here, then come back in there
          s.alpha = Math.max(0, s.alpha - dt / 0.09);
          if (s.alpha === 0) Object.assign(s, target, { alpha: 0 });
        } else {
          const f = 1 - Math.exp(-dt / 0.06);
          s.x += (target.x - s.x) * f;
          s.y += (target.y - s.y) * f;
          s.angle += turn * f;
          s.w = target.w;
          s.h = target.h;
          s.alpha += Math.max(-dt / 0.12, Math.min(dt / 0.18, visible - s.alpha));
        }
      }
      out.push({ ...s });
    }
    return out;
  }

  let last = performance.now();
  let pending = 0;
  // A browser check can freeze the real-time loop (`__sandbox.freeze()`): from then on only `advance` moves the court, and taps, holds and
  // carries, and how old a trail or a pow is, are timed by the court's own clock, so a slow machine cannot change what a check sees.
  let frozen = false;
  const clock = (real: number) => (frozen ? simMs : real);
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
    const drawnAt = clock(now);
    court.balls.forEach((b, i) => {
      if (leavesTrail(b)) renderer.trail(sprites[i], drawnAt);
    });
    // the zip pull's and the notebook's buttons give way where a can out of the bag stands in front of them
    scene.giveWayTo(
      court.cans.map((c) => {
        const at = toScreen(c.x, c.y);
        const k = pxPerMeter * c.scale;
        const ex = (Math.abs(Math.cos(c.angle)) * CAN_WIDTH + Math.abs(Math.sin(c.angle)) * CAN_HEIGHT) * k * 0.5;
        const ey = (Math.abs(Math.sin(c.angle)) * CAN_WIDTH + Math.abs(Math.cos(c.angle)) * CAN_HEIGHT) * k * 0.5;
        return { x0: at.x - ex, y0: at.y - ey, x1: at.x + ex, y1: at.y + ey };
      }),
    );
    drawnGhosts = ghosts(drawnAt, frozen);
    drawTrophy();
    shower?.draw();
    renderer.draw(drawnAt, sprites, risingSprites(), ballShadows(sprites), canSprites(alpha), drawnGhosts);
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
          /** Whether a standing can leans on it, holding it still. */
          propping: court.isPropping(b.id),
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
          width: CAN_WIDTH * pxPerMeter * c.scale,
          height: CAN_HEIGHT * pxPerMeter * c.scale,
          /** `placed` (standing, fixed), `held`, `settling` (falling), `pour` or `wiggle`. */
          state: court.canState(c.id),
        })),
      /** Put a can on the court at a point (page px), turned `degrees` clockwise, with `balls` in it. It falls from there. Gives its id. */
      addCan(x: number, y: number, balls = CAN_BALLS, degrees = 0) {
        const at = toMeters({ x, y });
        return court.addCan(at.x, at.y, (-degrees * Math.PI) / 180, balls, 1).id;
      },
      /** The drop preview's shadows as last drawn, one per carried can (page px, radians clockwise, alpha 0 to 1). */
      ghosts: () => drawnGhosts.map(({ id, x, y, angle, alpha }) => ({ id, x, y, angle, alpha })),
      /** Where a carried can would come to rest if let go now (page px, radians clockwise), or null when it is not carried. */
      rest: (id: number) => {
        const r = court.restOf(id);
        return r && { ...toScreen(r.x, r.y), angle: -r.a };
      },
      lastHit: () => lastHit,
      /** Throw a ball from a point on the page, as a hand would (page px and px/s, y down). Gives its id. */
      launch(x: number, y: number, vx: number, vy: number) {
        const at = toMeters({ x, y });
        return court.launch(at.x, at.y, vx / pxPerMeter, -vy / pxPerMeter).id;
      },
      /** The cans standing in the open bag that take balls: which, how many more, and where the mouth is (page px). */
      bagMouths: () => court.bagMouths.map((m) => ({ seed: m.seed, room: m.room, ...toScreen(m.mouth.x, m.mouth.y), half: m.mouth.half * pxPerMeter })),
      /** Take a ball off the court. */
      remove(id: number) {
        court.remove(id);
      },
      /** The cans game: whether it is found, the two calls on the board, whether it is championship point, how the last ball into a can was judged, and the crowd sounds started. */
      game: () => ({
        found: game.match.found,
        won: game.match.won,
        you: game.match.call(game.match.you),
        them: game.match.call(game.match.them),
        championshipPoint: game.match.championshipPoint,
        lastEntry,
        heard: [...heard],
        /** What the celebration did, in order, with the court's time in seconds (a glint says where, page px). */
        log: celebrationLog.map((e) => ({ ...e })),
        /** The trophy once won: where its foot is, its size as drawn (px), its turn (radians clockwise), and whether it floats. */
        trophy: trophy && (() => {
          const { at, k } = trophyAt();
          return { x: at.x, y: at.y, width: TROPHY_ART.w * k, height: TROPHY_ART.h * k, angle: 0, floating: true };
        })(),
      }),
      /** Win a point as a counted throw would, once the game is found. */
      scorePoint() {
        if (game.match.found) scorePoint();
      },
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
        // the shadow's glide and fade run on the court's clock too, so what `ghosts()` reports follows `advance` and not the page's frames
        if (frozen) drawnGhosts = ghosts(simMs, true);
      },
      /** Stop the real-time loop: the court then moves only when `advance` is called, and presses are timed by the court's clock. */
      freeze() {
        frozen = true;
        pending = 0;
        // Whatever the page did on its own clock before this call (how many frames ran, how far the dots had risen) depends on how fast the
        // machine was. The balls start again from the same place every time: swept off, then both dots refilled and run until they have
        // risen and settled, so that a seeded check gives the same answer on any machine. (The bag, the notebook and the cans are left as
        // they are.)
        gestures.cancel();
        for (const ball of [...court.balls]) court.remove(ball.id);
        restarted = true;
        for (const home of homes) {
          home.ballId = null;
          home.risingSince = null;
          home.emptySince = simMs - REFILL_DELAY_MS;
        }
        for (let i = 0; i < 600 && homes.some((h) => h.ballId === null); i++) stepOnce();
        for (let i = 0; i < 120; i++) stepOnce();
        gestures.tick(simMs);
      },
    },
  });
}

main();
