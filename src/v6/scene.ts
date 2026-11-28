import "./scene.css";
import { params } from "../params";
import type { NameLayout } from "../wordmark";
import {
  BAG_ANCHOR,
  BAG_D,
  BAG_VB,
  BENCH,
  CAN,
  HEAD_OUT,
  ITEMS,
  NOTEBOOK,
  RACQUET_TILT,
  SHADOW,
  SHADOW_OPACITY,
  armX,
  bagBack,
  bagFront,
  bagOutline,
  bagTopAt,
  bench,
  can,
  depth,
  frontTopAt,
  notebookArt,
  pullAt,
  racquet,
  sampleF,
  sinkDepth,
  towel,
  type Art,
  type Item,
  type P,
} from "./art";

/**
 * The v6 scene on the toy's page, at real size: a players' bench cropped by the bottom of the window, a towel over its
 * left end, the racquet bag on the seat, and a racquet leaning head down against the bench's front edge.
 *
 * Three layers. Behind the toy's canvas: the bench, towel, their shadows and the bag (with what stands in it). In front
 * of the canvas: the racquet, which is not solid, so balls pass behind it. Above both: invisible buttons over the zip
 * pull and the notebook, so they can be dragged, clicked and reached with the keyboard.
 */

// ---- Where things go, in real millimeters (the scene is at the toy's scale: a ball is 67 mm) ----
/** How much of the bench's 42 cm front shows above the bottom of the window. */
const BENCH_SHOWS = 165;
/**
 * How far back (mm) a ball beside the bench's left end stops. Half way back, where the balls on the seat are, would put
 * nine tenths of it behind the bench's front left corner; at 150 about two fifths of it shows, enough to find and take.
 */
const LEFT_END_DEPTH = 150;
/** The bag's right end stands this far past the right end of the name's outline (at 1280 x 800, as on the v6 canvas). */
const BAG_PAST_NAME = 54;
/** The bag stands toward the front of the seat: its front this share of the way back across the seat. */
const BAG_SEAT = 0.25;
/** How far along the bench the bag's anchor sits, from the bench's left end. */
const BAG_ALONG = 908;
/** Where the racquet's head stands, from the bench's left end. */
const RACQUET_ALONG = 444;
/** Where the towel's left edge lies, from the bench's left end. */
const TOWEL_ALONG = 20;
/** Clear space kept between the bottom of the name and the tops of what stands in the open bag (as on the 1280 x 800
 * canvas), and between the name and the shut bag's top. */
const GAP_OPEN = 50;
const GAP_CLOSED = 20;
/** The shut bag's top (its back top edge) above its bottom front edge, mm. */
const BAG_TOP = 292 - BAG_D[1];
/** On a short window (a wide desktop, a phone held sideways) less of the bench shows, down to this much of its front. */
const MIN_SHOWS = 40;
/** Then the cans and the notebook stop lower in the bag, by up to this much (they come most of the way out); the scene is drawn smaller to make room. */
const MAX_SINK = 45;
/** The corner buttons' size and their gap from the window's edges (the "?" sits alone at the bottom right). */
const CHIP_ZONE = 12 + 44 + 8;

/** How far the tallest thing standing in the open bag reaches above the bag's own bottom front edge, mm. */
const OPEN_REACH = Math.max(
  ...ITEMS.map((it) => {
    const { w, h } = it.kind === "can" ? CAN : NOTEBOOK;
    const a = (Math.abs(it.tilt) * Math.PI) / 180;
    return -(it.y - h * Math.cos(a) - (w / 2) * Math.sin(a));
  }),
);

// ---- Timing ----
// The numbers are in params.ts (zipMs, zipSnap, riseMs, riseStaggerMs, riseNotebookMs, sinkMs), where ?tune moves them. The cans rise one
// after another at riseStaggerMs apart, and the notebook, the last of the four, riseNotebookMs after the bag opens.
const riseDelay = (i: number) => (i < 3 ? i * params.riseStaggerMs : params.riseNotebookMs);

/** A damped spring as a CSS linear() easing: one overshoot of about 6%, then it settles. (From option A.) */
function springEasing(): string {
  const zeta = 0.66;
  const omega = 4.6 / zeta;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const points: string[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const x =
      i === 28 ? 1 : 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
    points.push(x.toFixed(4));
  }
  return `linear(${points.join(", ")})`;
}
const SPRING = typeof CSS !== "undefined" && CSS.supports("transition-timing-function", "linear(0, 1)") ? springEasing() : "cubic-bezier(0.34, 1.3, 0.64, 1)";

export interface SceneLayout {
  /** Page px per real mm. */
  k: number;
  width: number;
  height: number;
  benchX: number;
  benchFrontTop: number;
  /** The bench top as the physics sees it: the line half way back across it. */
  benchSurfaceY: number;
  floorFrontY: number;
  bagAt: P;
  towelAt: P;
  racquetAt: P;
  /** How much of the bench's front shows above the window's bottom edge, mm (165 on the canvas). */
  shows: number;
  /** How much lower than on the canvas the cans and the notebook stop in the open bag, mm (0 on the canvas). */
  sink: number;
  /** Clear space left between the name and the tops of what stands in the open bag, px. Negative: they overlap. */
  clearanceOpen: number;
  /** The scene's size as a share of real size: 1 except on windows too short for a real bag (a phone held sideways). */
  scale: number;
}

/**
 * Lay the scene out for a window and the name in it. At real size wherever it fits: a short window first shows less of
 * the bench, then lets what is in the bag stop lower, and only then draws the scene smaller.
 */
export function sceneLayout(width: number, height: number, name: NameLayout, lift = 0): SceneLayout {
  const real = name.ballPx / 67;
  let nameRight = -Infinity;
  for (const letter of name.letters) for (const loop of letter.loops) for (const p of loop) nameRight = Math.max(nameRight, p.x);
  const bagSpan = 782 + BAG_D[0];
  const benchPastBag = BENCH.L + BENCH.D[0] * (1 - BAG_SEAT) - BAG_ALONG - (782 - BAG_ANCHOR[0] + BAG_D[0]);
  /** Across: the bag's right end just past the name's, the bench under it; never under the "?" in the corner. */
  const bagRightAt = (k: number) => {
    const right = nameRight + BAG_PAST_NAME * k;
    return right - Math.max(0, right + benchPastBag * k - (width - CHIP_ZONE));
  };

  // down: the lowest letter above the bag, and how much room that leaves under it
  const right0 = bagRightAt(real);
  let nameBottom = name.origin.y;
  for (const letter of name.letters)
    for (const loop of letter.loops)
      for (const p of loop) if (p.x >= right0 - bagSpan * real && p.x <= right0) nameBottom = Math.max(nameBottom, p.y);
  const roomPx = height - nameBottom;
  const seat = -BENCH.D[1] * BAG_SEAT; // the bag's front edge stands this far above the bench's front edge on screen
  /** How tall the scene stands above the window's bottom edge, gaps included, mm. */
  const needs = (shows: number, sink: number) =>
    Math.max(shows + seat + OPEN_REACH - sink + GAP_OPEN, shows + seat + BAG_TOP + GAP_CLOSED);
  let k = real;
  let shows = Math.min(BENCH_SHOWS, roomPx / k - needs(0, 0));
  let sink = 0;
  if (shows < MIN_SHOWS) {
    shows = MIN_SHOWS;
    // last resort: smaller than real, just enough for the shut bag and the tops of what is in it to clear the name
    if (needs(MIN_SHOWS, MAX_SINK) * k > roomPx) k = roomPx / needs(MIN_SHOWS, MAX_SINK);
    sink = Math.max(0, Math.min(MAX_SINK, MIN_SHOWS + seat + OPEN_REACH + GAP_OPEN - roomPx / k));
  }

  // On a touch screen the floor is lifted `lift` px off the window's bottom (QWW-83). The bench stands on that same floor as the balls
  // do, so enough of it shows that its front edge is at or above the lifted floor (its seat line is higher still), and the scene is
  // drawn smaller to make room. (It also changes k, which changes how much that is: a few rounds settle it.)
  for (let round = 0; lift > 0 && round < 8; round++) {
    const seatShows = lift / k;
    if (shows >= seatShows - 1e-6) break;
    shows = seatShows;
    if (needs(shows, MAX_SINK) * k > roomPx) k = roomPx / needs(shows, MAX_SINK);
    sink = Math.max(0, Math.min(MAX_SINK, shows + seat + OPEN_REACH + GAP_OPEN - roomPx / k));
  }

  const bd: P = [BENCH.D[0] * k, BENCH.D[1] * k];
  const bagRight = bagRightAt(k);
  const bagX = bagRight - (782 - BAG_ANCHOR[0] + BAG_D[0]) * k;
  const benchX = bagX - BAG_ALONG * k - bd[0] * BAG_SEAT;
  const benchFrontTop = height - shows * k;
  const floorFrontY = benchFrontTop + BENCH.H * k;
  return {
    k,
    width,
    height,
    benchX,
    benchFrontTop,
    benchSurfaceY: benchFrontTop + bd[1] * 0.5,
    floorFrontY,
    bagAt: [bagX, benchFrontTop + bd[1] * BAG_SEAT],
    towelAt: [benchX + TOWEL_ALONG * k, benchFrontTop],
    racquetAt: [benchX + RACQUET_ALONG * k, floorFrontY + depth(-HEAD_OUT)[1] * k],
    shows,
    sink,
    clearanceOpen: roomPx - (shows + seat + OPEN_REACH - sink) * k,
    scale: k / real,
  };
}

/** Bag millimeters to page px. */
function bagToPage(L: SceneLayout, p: P): P {
  return [L.bagAt[0] + (p[0] - BAG_ANCHOR[0]) * L.k, L.bagAt[1] + p[1] * L.k];
}

/**
 * The scene's solid shapes that never change, page px: the bench (its top half way back across the seat, standing on the floor
 * below the window) and the bag's outline.
 */
export function sceneSolids(L: SceneLayout): { bench: P[]; bag: P[] } {
  return { bench: benchOutline(L).loop, bag: bagOutline().map((p) => bagToPage(L, p)) };
}

/**
 * The bench's outline, page px: its top half way back across the seat, standing on the floor below the window. Beside its left
 * end a ball stops LEFT_END_DEPTH back: the outline goes straight down from the seat line at that depth. `left` is the top's
 * left edge at that depth, which the cover's clip uses too.
 */
function benchOutline(L: SceneLayout): { loop: P[]; left: P } {
  const x0 = L.benchX + depth(BENCH.Dmm / 2)[0] * L.k;
  const x1 = x0 + BENCH.L * L.k;
  const left: P = [L.benchX + depth(LEFT_END_DEPTH)[0] * L.k, L.benchFrontTop + depth(LEFT_END_DEPTH)[1] * L.k];
  const bottom = L.height + 400;
  return {
    loop: [
      [x0, L.benchSurfaceY],
      [x1, L.benchSurfaceY],
      [x1, bottom],
      [left[0], bottom],
      // The end's face goes up to the seat line, not just to the top's left edge 150 mm back: on a phone the floor is lifted until the
      // bench's front edge is level with it, which puts that corner only a ball's radius above the floor, and a ball rolling in
      // would ride up over it onto the seat. (The outline stays convex, as the physics needs.)
      [left[0], L.benchSurfaceY],
    ],
    left,
  };
}

/** An item's outline standing in the bag, bag mm: its box turned by its tilt about its foot, `sink` mm lower along its
 * own length than on the canvas. */
function itemBox(it: Item, sink: number): P[] {
  const { w, h } = it.kind === "can" ? CAN : NOTEBOOK;
  const a = (it.tilt * Math.PI) / 180;
  const turn = ([x, y]: P): P => [it.x + x * Math.cos(a) - (y + sink) * Math.sin(a), it.y + x * Math.sin(a) + (y + sink) * Math.cos(a)];
  return ([[-w / 2, 0], [w / 2, 0], [w / 2, -h], [-w / 2, -h]] as P[]).map(turn);
}
/** The middle of an item standing in the bag, bag mm. */
function itemMiddle(it: Item, sink: number): P {
  const h = it.kind === "can" ? CAN.h : NOTEBOOK.h;
  const a = (it.tilt * Math.PI) / 180;
  const up = h / 2 - sink;
  return [it.x + up * Math.sin(a), it.y - up * Math.cos(a)];
}

/** The notebook's box as drawn in the bag, page px: its middle, size and tilt. For the notebook overlay. */
export interface NotebookBox {
  x: number;
  y: number;
  width: number;
  height: number;
  tilt: number;
}

export interface SceneOptions {
  reducedMotion: boolean;
  /** The solid shapes that change while the toy runs (what stands in the open bag), page px. */
  onSolids(loops: P[][]): void;
  /** The notebook was clicked: open it from where it stands. */
  onNotebook(box: NotebookBox, opener: HTMLElement): void;
  /** The visitor did something: unzipped, opened the notebook. For the analytics. */
  onInteraction(kind: "unzip" | "notebook"): void;
  /** The zip moved to `zip` (0 shut, 1 open), by a drag, a key or a run (`running`: by itself, frame by frame). */
  onZip(zip: number, running: boolean): void;
  /** A run of the zip is over or was cut short: the sound of it ends now. */
  onZipStop(): void;
}

const svgNS = "http://www.w3.org/2000/svg";
function svgEl(art: Art | null, cls: string): SVGSVGElement {
  const el = document.createElementNS(svgNS, "svg");
  el.setAttribute("class", cls);
  el.setAttribute("aria-hidden", "true");
  if (art) {
    el.setAttribute("viewBox", art.vb.join(" "));
    el.innerHTML = art.body;
  }
  return el;
}
/** Put an SVG on the page so that its point `anchor` (its own units) lands on `at` (page px), `k` px per unit. */
function put(el: SVGSVGElement, vb: Art["vb"], anchor: P, at: P, k: number, rot = 0): void {
  const [vx, vy, vw, vh] = vb;
  const ox = (anchor[0] - vx) * k;
  const oy = (anchor[1] - vy) * k;
  Object.assign(el.style, {
    left: `${at[0] - ox}px`,
    top: `${at[1] - oy}px`,
    width: `${vw * k}px`,
    height: `${vh * k}px`,
    transformOrigin: `${ox}px ${oy}px`,
    transform: rot ? `rotate(${rot}deg)` : "",
  });
}

export class Scene {
  layout!: SceneLayout;
  /** 0 closed, 1 open. */
  zip = 0;
  /** The zip has run all the way and what is in the bag has come up. */
  open = false;
  /** The notebook is out of the bag (lying open over the toy). */
  notebookOut = false;
  /** The cans taken out of the bag, by their place in ITEMS. */
  private taken = new Set<number>();

  private back: HTMLElement;
  /** Over the canvas: the bench's front left corner and the towel on it, in front of a ball beside the bench's left end. */
  private cover: HTMLElement;
  private benchCoverSvg: SVGSVGElement;
  /** Over the canvas: the bag's art (no contents) clipped to its left end, in front of a ball resting against that end. */
  private bagCover: HTMLElement;
  private bagCoverSvg: SVGSVGElement;
  private bagCoverBackG: SVGGElement;
  private bagCoverFrontG: SVGGElement;
  private towelCoverSvg: SVGSVGElement;
  private front: HTMLElement;
  private hit: HTMLElement;
  private benchSvg: SVGSVGElement;
  private towelSvg: SVGSVGElement;
  private shadowsSvg: SVGSVGElement;
  private bagSvg: SVGSVGElement;
  private bagBackG: SVGGElement;
  private itemsG: SVGGElement;
  private bagFrontG: SVGGElement;
  private racquetSvg: SVGSVGElement;
  private pullButton: HTMLButtonElement;
  private notebookButton: HTMLButtonElement;
  private rises: SVGGElement[] = [];
  private riseAnims: Animation[] = [];
  private zipAnim = 0;
  private dragging: { id: number; offset: P } | null = null;
  private track: { zip: number; at: P }[] = [];

  constructor(
    private opts: SceneOptions,
    canvas: HTMLCanvasElement,
  ) {
    this.back = document.createElement("div");
    this.back.className = "v6-back";
    this.cover = document.createElement("div");
    this.cover.className = "v6-cover";
    this.bagCover = document.createElement("div");
    this.bagCover.className = "v6-bagcover";
    this.front = document.createElement("div");
    this.front.className = "v6-front";
    this.hit = document.createElement("div");
    this.hit.className = "v6-hit";

    const benchArt = bench();
    const towelArt = towel();
    const racquetArt = racquet();
    this.benchSvg = svgEl(benchArt, "v6-art");
    this.towelSvg = svgEl(towelArt, "v6-art");
    this.benchCoverSvg = svgEl(benchArt, "v6-art");
    this.towelCoverSvg = svgEl(towelArt, "v6-art");
    this.cover.append(this.benchCoverSvg, this.towelCoverSvg);
    this.shadowsSvg = svgEl(null, "v6-art");
    this.bagSvg = svgEl(null, "v6-art");
    this.bagSvg.setAttribute("viewBox", BAG_VB.join(" "));
    this.racquetSvg = svgEl(racquetArt, "v6-art");

    this.bagBackG = document.createElementNS(svgNS, "g");
    this.itemsG = document.createElementNS(svgNS, "g");
    this.bagFrontG = document.createElementNS(svgNS, "g");
    this.itemsG.innerHTML = ITEMS.map(
      (it) =>
        `<g transform="translate(${it.x} ${it.y}) rotate(${it.tilt})"><g class="v6-rise">${it.kind === "can" ? can(it.seed) : notebookArt()}</g></g>`,
    ).join("");
    this.rises = [...this.itemsG.querySelectorAll<SVGGElement>(".v6-rise")];
    this.bagSvg.append(this.bagBackG, this.itemsG, this.bagFrontG);
    this.bagCoverSvg = svgEl(null, "v6-art");
    this.bagCoverSvg.setAttribute("viewBox", BAG_VB.join(" "));
    this.bagCoverBackG = document.createElementNS(svgNS, "g");
    this.bagCoverFrontG = document.createElementNS(svgNS, "g");
    this.bagCoverSvg.append(this.bagCoverBackG, this.bagCoverFrontG);
    this.bagCover.append(this.bagCoverSvg);

    this.back.append(this.benchSvg, this.towelSvg, this.shadowsSvg, this.bagSvg);
    this.front.append(this.racquetSvg);

    this.pullButton = document.createElement("button");
    this.pullButton.type = "button";
    this.pullButton.className = "v6-pull";
    this.pullButton.setAttribute("aria-label", "Unzip the bag: drag the green pull along the zip");
    this.notebookButton = document.createElement("button");
    this.notebookButton.type = "button";
    this.notebookButton.className = "v6-notebook-hit";
    this.notebookButton.setAttribute("aria-label", "Open the notebook");
    this.hit.append(this.pullButton, this.notebookButton);

    canvas.before(this.back);
    canvas.after(this.bagCover, this.cover, this.front, this.hit);

    this.wirePull();
    this.notebookButton.addEventListener("click", () => this.takeNotebook());
    this.drawBag();
    this.syncItems(false);
  }

  /** Lay the scene out for the window. Returns the solid shapes that never change: the bench and the bag, page px. */
  place(width: number, height: number, name: NameLayout, lift = 0): { bench: P[]; bag: P[] } {
    const L = (this.layout = sceneLayout(width, height, name, lift));
    const { k } = L;
    put(this.benchSvg, bench().vb, [0, 0], [L.benchX, L.floorFrontY], k);
    put(this.towelSvg, towel().vb, [0, 0], L.towelAt, k);
    // A ball beside the bench's left end is LEFT_END_DEPTH back, so the bench's front left corner (and the towel on it) stand in
    // front of it: the cover repeats them over the canvas, clipped to the part of the bench in front of that depth. (On the right
    // the bench's end faces the camera, and a ball beside it is in front of it.)
    put(this.benchCoverSvg, bench().vb, [0, 0], [L.benchX, L.floorFrontY], k);
    put(this.towelCoverSvg, towel().vb, [0, 0], L.towelAt, k);
    const left = benchOutline(L).left;
    const corner: P[] = [
      [L.benchX, L.benchFrontTop],
      left,
      [left[0], L.height + 400],
      [L.benchX, L.height + 400],
    ];
    this.cover.style.clipPath = `polygon(${corner.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ")})`;
    put(this.bagSvg, BAG_VB, BAG_ANCHOR, L.bagAt, k);
    // The balls land on the bag's outline half way back, so one resting against its left end overlaps the drawn front panel's
    // bulging end: the cover repeats the bag over the canvas, clipped to what lies left of that outline's leftmost point.
    put(this.bagCoverSvg, BAG_VB, BAG_ANCHOR, L.bagAt, k);
    const bagLeft = Math.min(...bagOutline().map((p) => bagToPage(L, p)[0]));
    this.bagCover.style.clipPath = `polygon(0px 0px, ${bagLeft.toFixed(1)}px 0px, ${bagLeft.toFixed(1)}px ${L.height}px, 0px ${L.height}px)`;
    put(this.racquetSvg, racquet().vb, [0, 0], L.racquetAt, k, RACQUET_TILT);
    this.drawShadows();
    // what stands in the open bag stops where this window lets it
    if (this.open) this.rises.forEach((rise, i) => !this.isOut(i) && (rise.style.transform = this.upTransform()));

    // the pull's path, page px, for dragging it
    this.track = Array.from({ length: 121 }, (_, i) => {
      const zip = i / 120;
      const p = pullAt(zip);
      return { zip, at: bagToPage(L, [p.x, p.y]) };
    });
    this.placePull();
    this.placeNotebookButton();

    return sceneSolids(L);
  }

  /** What stands in the open bag, page px: balls land on the cans' lids and the notebook. */
  openSolids(): P[][] {
    if (!this.open) return [];
    return ITEMS.filter((it, i) => !this.isOut(i)).map((it) => itemBox(it, this.layout.sink).map((p) => bagToPage(this.layout, p)));
  }

  /** The cans standing in the open bag, each with the middle of its mouth (page px), its tilt (degrees, clockwise) and its width (page px): they take balls too. */
  canMouths(): { seed: number; x: number; y: number; tilt: number; width: number }[] {
    if (!this.open || !this.layout) return [];
    return ITEMS.flatMap((it, i) => {
      if (it.kind !== "can" || this.taken.has(i)) return [];
      // the box runs foot left, foot right, top right, top left
      const box = itemBox(it, this.layout.sink).map((p) => bagToPage(this.layout, p));
      return [{ seed: it.seed, x: (box[2][0] + box[3][0]) / 2, y: (box[2][1] + box[3][1]) / 2, tilt: it.tilt, width: CAN.w * this.layout.k }];
    });
  }

  /** Where an item stands when it is up, as the transform of its rising group. */
  private upTransform(): string {
    return `translateY(${(this.layout?.sink ?? 0).toFixed(1)}px)`;
  }

  /** Whether an item has been taken out of the bag. */
  private isOut(i: number): boolean {
    return ITEMS[i].kind === "notebook" ? this.notebookOut : this.taken.has(i);
  }

  /** The can standing in the open bag under a point (page px), by its place in ITEMS, or -1. */
  canAt(x: number, y: number): number {
    if (!this.open) return -1;
    // only the part of a can that shows above the bag's front can be taken hold of
    const L = this.layout;
    if (y > L.bagAt[1] + frontTopAt(BAG_ANCHOR[0] + (x - L.bagAt[0]) / L.k) * L.k) return -1;
    for (let i = 0; i < ITEMS.length; i++) {
      if (ITEMS[i].kind !== "can" || this.taken.has(i)) continue;
      const box = itemBox(ITEMS[i], L.sink).map((p) => bagToPage(this.layout, p));
      let inside = false;
      for (let a = 0, b = box.length - 1; a < box.length; b = a++) {
        if (box[a][1] > y !== box[b][1] > y && x < ((box[b][0] - box[a][0]) * (y - box[a][1])) / (box[b][1] - box[a][1]) + box[a][0]) inside = !inside;
      }
      if (inside) return i;
    }
    return -1;
  }

  /** Take a can out of the bag. Returns where its middle was (page px), its tilt (degrees, clockwise) and which can it
   * is, for the court to carry on with. */
  takeCan(i: number): { x: number; y: number; tilt: number; seed: number } {
    const it = ITEMS[i];
    const [x, y] = bagToPage(this.layout, itemMiddle(it, this.layout.sink));
    this.taken.add(i);
    this.rises[i].style.visibility = "hidden";
    this.opts.onSolids(this.openSolids());
    return { x, y, tilt: it.tilt, seed: it.seed };
  }

  /** A can let go before it was clear of the bag drops back into its place. `seed` says which can. */
  returnCan(seed: number): void {
    const i = ITEMS.findIndex((it) => it.kind === "can" && it.seed === seed);
    if (i < 0 || !this.taken.delete(i)) return;
    this.rises[i].style.visibility = this.open ? "visible" : "hidden";
    this.rises[i].style.transform = this.open ? this.upTransform() : `translateY(${sinkDepth(ITEMS[i]).toFixed(1)}px)`;
    this.opts.onSolids(this.openSolids());
  }

  /** Draw a can standing in the bag holding `balls` balls: empty once it has been poured. */
  setCanBalls(seed: number, balls: number): void {
    const i = ITEMS.findIndex((it) => it.kind === "can" && it.seed === seed);
    if (i >= 0) this.rises[i].innerHTML = can(seed, Math.max(0, Math.min(3, balls)));
  }

  /**
   * The zip pull's and the notebook's invisible buttons step aside (let presses through to the toy) wherever a can out of the bag
   * covers them, page px boxes, so a can standing in front of them can still be tapped and carried. The keyboard still reaches them.
   */
  giveWayTo(boxes: { x0: number; y0: number; x1: number; y1: number }[]): void {
    for (const b of [this.pullButton, this.notebookButton]) {
      const s = b.style;
      const [x0, y0] = [parseFloat(s.left), parseFloat(s.top)];
      const [x1, y1] = [x0 + parseFloat(s.width), y0 + parseFloat(s.height)];
      const covered = boxes.some((q) => q.x0 < x1 && q.x1 > x0 && q.y0 < y1 && q.y1 > y0);
      const want = covered ? "none" : "";
      if (s.pointerEvents !== want) s.pointerEvents = want;
    }
  }

  /** The bag's front panel on the page (px): what stands in the bag is behind it. */
  frontFace(): P[] {
    return this.layout ? sampleF().map((p) => bagToPage(this.layout, p)) : [];
  }

  /** The surface straight below a point, if any: the top of the bag or the bench, page px. For the balls' shadows. */
  surfaceBelow(x: number, y: number): number | null {
    const L = this.layout;
    if (!L) return null;
    const bagX = BAG_ANCHOR[0] + (x - L.bagAt[0]) / L.k;
    const top = bagTopAt(bagX);
    if (top !== null) {
      const ty = L.bagAt[1] + top * L.k;
      if (ty >= y - 2) return ty;
    }
    const x0 = L.benchX + depth(BENCH.Dmm / 2)[0] * L.k;
    if (x >= x0 && x <= x0 + BENCH.L * L.k && L.benchSurfaceY >= y - 2) return L.benchSurfaceY;
    return null;
  }

  /** Restart: zip the bag shut, everything back in it, the cans full again. */
  reset(): void {
    this.dragging = null;
    cancelAnimationFrame(this.zipAnim);
    // what was out of the bag is back in it, out of sight; what is standing in it sinks as the zip runs shut
    for (let i = 0; i < ITEMS.length; i++) {
      if (this.isOut(i)) this.rises[i].style.transform = `translateY(${sinkDepth(ITEMS[i]).toFixed(1)}px)`;
    }
    this.notebookOut = false;
    this.taken.clear();
    this.open = false;
    this.syncItems(true);
    this.opts.onSolids(this.openSolids());
    this.runZip(0, true);
  }

  // ---- drawing ----

  private drawBag(): void {
    this.bagBackG.innerHTML = bagBack(this.zip);
    this.bagFrontG.innerHTML = bagFront(this.zip);
    this.bagCoverBackG.innerHTML = bagBack(this.zip);
    this.bagCoverFrontG.innerHTML = bagFront(this.zip);
  }

  private drawShadows(): void {
    const L = this.layout;
    const { k } = L;
    const tilt = (RACQUET_TILT * Math.PI) / 180;
    // the racquet throws its shadow straight down to the floor below the window; what shows is a little shade under
    // each throat arm where the bench's front edge touches it
    const yR = -(L.racquetAt[1] - L.benchFrontTop) / Math.cos(tilt) / k;
    const pageX = (x: number, y: number) => L.racquetAt[0] + (x * Math.cos(tilt) - y * Math.sin(tilt)) * k;
    const shades = [-1, 1]
      .map(
        (side) =>
          `<ellipse cx="${pageX(armX(side, yR), yR).toFixed(1)}" cy="${(L.benchFrontTop + 3.4 * k).toFixed(1)}" rx="${(9.5 * k).toFixed(1)}" ry="${(4.1 * k).toFixed(1)}" fill="${SHADOW}" fill-opacity="${SHADOW_OPACITY}"/>`,
      )
      .join("");
    this.shadowsSvg.setAttribute("viewBox", `0 0 ${L.width} ${L.height}`);
    Object.assign(this.shadowsSvg.style, { left: "0px", top: "0px", width: `${L.width}px`, height: `${L.height}px` });
    this.shadowsSvg.innerHTML = shades;
  }

  // ---- the zip ----

  private setZip(zip: number, running = false): void {
    const before = this.zip;
    this.zip = Math.max(0, Math.min(1, zip));
    if (this.zip !== before) this.opts.onZip(this.zip, running);
    this.drawBag();
    this.placePull();
    if (this.open && this.zip < 1) this.setOpen(false);
  }

  /** Run the zip to `to` by itself, then open or close the bag. */
  private runZip(to: number, quick = false): void {
    cancelAnimationFrame(this.zipAnim);
    this.opts.onZipStop();
    const from = this.zip;
    const ms = (this.opts.reducedMotion ? 0 : params.zipMs * (quick ? 0.6 : 1)) * Math.abs(to - from);
    const start = performance.now();
    const tick = (now: number) => {
      const t = ms ? Math.min(1, (now - start) / ms) : 1;
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.setZip(from + (to - from) * eased, t < 1);
      if (t < 1) this.zipAnim = requestAnimationFrame(tick);
      else {
        this.opts.onZipStop();
        if (to >= 1) this.setOpen(true);
      }
    };
    if (ms) this.zipAnim = requestAnimationFrame(tick);
    else tick(start);
  }

  private placePull(): void {
    if (!this.layout) return;
    const L = this.layout;
    const p = pullAt(this.zip);
    // the button covers the slider and the tab hanging under it, and never smaller than a fingertip
    const [x, y] = bagToPage(L, [p.x, p.y + 24]);
    const w = Math.max(44, 40 * L.k);
    const h = Math.max(48, 74 * L.k);
    Object.assign(this.pullButton.style, { left: `${x - w / 2}px`, top: `${y - h / 2}px`, width: `${w}px`, height: `${h}px` });
    this.pullButton.setAttribute("aria-valuenow", String(Math.round(this.zip * 100)));
  }

  private wirePull(): void {
    const b = this.pullButton;
    b.setAttribute("role", "slider");
    b.setAttribute("aria-valuemin", "0");
    b.setAttribute("aria-valuemax", "100");
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      cancelAnimationFrame(this.zipAnim);
      this.opts.onZipStop();
      const slider = this.track[Math.round(this.zip * 120)].at;
      this.dragging = { id: e.pointerId, offset: [e.clientX - slider[0], e.clientY - slider[1]] };
      b.setPointerCapture(e.pointerId);
      b.classList.add("is-dragging");
    });
    b.addEventListener("pointermove", (e) => {
      if (!this.dragging || e.pointerId !== this.dragging.id) return;
      const target: P = [e.clientX - this.dragging.offset[0], e.clientY - this.dragging.offset[1]];
      // the point of the zip nearest the finger (the zip runs left to right along the top, then down the bag's round end,
      // so no two stretches of it lie close together)
      let best = this.zip;
      let bestD = Infinity;
      for (const t of this.track) {
        const d = Math.hypot(t.at[0] - target[0], t.at[1] - target[1]);
        if (d < bestD) [best, bestD] = [t.zip, d];
      }
      if (best !== this.zip) {
        if (this.zip === 0 && best > 0) this.opts.onInteraction("unzip");
        this.setZip(best);
      }
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging || e.pointerId !== this.dragging.id) return;
      this.dragging = null;
      b.classList.remove("is-dragging");
      // a zip stays where it is let go, except near the end, where it runs on and the bag opens
      if (this.zip >= params.zipSnap) this.runZip(1);
    };
    b.addEventListener("pointerup", end);
    b.addEventListener("pointercancel", end);
    // From the keyboard: Enter or Space runs the zip all the way open or shut; the arrows move it in steps.
    b.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (this.zip < 1) this.opts.onInteraction("unzip");
        this.runZip(this.zip < 1 ? 1 : 0);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const to = this.zip + (e.key === "ArrowRight" ? 0.1 : -0.1);
        if (to >= 1) this.runZip(1);
        else this.setZip(to);
      }
    });
  }

  // ---- what stands in the bag ----

  private setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.syncItems(true);
    this.opts.onSolids(this.openSolids());
  }

  /** Bring what is in the bag up (open) or send it back down, the notebook too unless it is out. */
  private syncItems(animate: boolean): void {
    for (const a of this.riseAnims) a.cancel();
    this.riseAnims = [];
    const reduced = this.opts.reducedMotion || !animate;
    this.itemsG.style.visibility = "visible";
    this.rises.forEach((rise, i) => {
      const it = ITEMS[i];
      const down = `translateY(${sinkDepth(it).toFixed(1)}px)`;
      const hidden = this.isOut(i);
      rise.style.visibility = hidden ? "hidden" : "visible";
      const to = this.open ? this.upTransform() : down;
      if (reduced) {
        rise.style.transform = to;
        return;
      }
      const from = getComputedStyle(rise).transform === "none" ? down : getComputedStyle(rise).transform;
      rise.style.transform = to;
      this.riseAnims.push(
        rise.animate(
          [{ transform: from }, { transform: to }],
          this.open
            ? { duration: params.riseMs, delay: riseDelay(i), easing: SPRING, fill: "backwards" }
            : { duration: params.sinkMs, easing: "cubic-bezier(0.5, 0, 0.9, 0.5)" },
        ),
      );
    });
    if (!this.open) {
      const done = Promise.all(this.riseAnims.map((a) => a.finished));
      done.then(
        () => {
          if (!this.open) this.itemsG.style.visibility = "hidden";
        },
        () => {},
      );
    }
    this.placeNotebookButton();
  }

  private notebookItem(): Item {
    return ITEMS.find((it) => it.kind === "notebook")!;
  }

  /** The notebook's box in the open bag, page px. */
  notebookBox(): NotebookBox {
    const L = this.layout;
    const it = this.notebookItem();
    const [x, y] = bagToPage(L, itemMiddle(it, L.sink));
    return { x, y, width: NOTEBOOK.w * L.k, height: NOTEBOOK.h * L.k, tilt: it.tilt };
  }

  private placeNotebookButton(): void {
    if (!this.layout) return;
    const box = this.notebookBox();
    const ready = this.open && !this.notebookOut;
    Object.assign(this.notebookButton.style, {
      left: `${box.x - box.width / 2}px`,
      top: `${box.y - box.height / 2}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      transform: `rotate(${box.tilt}deg)`,
      display: ready ? "block" : "none",
    });
  }

  private takeNotebook(): void {
    if (!this.open || this.notebookOut) return;
    const box = this.notebookBox();
    this.notebookOut = true;
    this.rises[ITEMS.indexOf(this.notebookItem())].style.visibility = "hidden";
    this.placeNotebookButton();
    this.opts.onSolids(this.openSolids());
    this.opts.onInteraction("notebook");
    this.opts.onNotebook(box, this.notebookButton);
  }

  /** The notebook has been closed: it is back in the bag. */
  notebookBack(): void {
    if (!this.notebookOut) return;
    this.notebookOut = false;
    const rise = this.rises[ITEMS.indexOf(this.notebookItem())];
    rise.style.visibility = "visible";
    rise.style.transform = this.open ? this.upTransform() : `translateY(${sinkDepth(this.notebookItem()).toFixed(1)}px)`;
    this.placeNotebookButton();
    this.opts.onSolids(this.openSolids());
    if (this.open) this.notebookButton.focus({ preventScroll: true });
  }

  /** For checks: where the pull is on the page, px. */
  pullPoint(): P {
    return this.track[Math.round(this.zip * 120)].at;
  }

  /** For checks: where the pull would be at a given progress, page px. */
  zipPoint(zip: number): P {
    const p = pullAt(Math.max(0, Math.min(1, zip)));
    return bagToPage(this.layout, [p.x, p.y]);
  }
}
