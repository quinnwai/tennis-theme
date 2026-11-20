/**
 * The v6 notebook. A click on the notebook in the open bag lifts it out toward the middle of the window, where it lies
 * open as one spread with all its words on it, over the toy blurred and dimmed. Nothing turns: the close chip, Escape
 * or a click outside the spread sends it back down into the bag.
 *
 * A runtime port of design/v6/notebook/gen-notebook.mjs, the generator for the approved stills (shots/nb-lift.png and
 * shots/nb-open.png): the same art, numbers, colours, shadows and chip. The words are real text in one element, in two
 * columns that sit on the two pages' rules, so they can be selected and are read in order.
 */
import "./notebook.css";
import { NOTEBOOK_TEXT } from "../notebook-text";
import { params } from "../params";

/** The closed notebook's box as drawn in the bag, page px: its middle, its size, and its tilt in degrees. */
export interface NotebookBox {
  x: number;
  y: number;
  width: number;
  height: number;
  tilt: number;
}

export interface Notebook {
  /** Lift the notebook from `from` to the middle and open it. Focus goes to the close chip, and to `opener` after. */
  open(from: NotebookBox, opener?: HTMLElement): void;
  /** Close it and send it back down to where it came from; `onClosed` runs once it is there. */
  close(): void;
  /** Whether the notebook is out of the bag: from `open` until it is back down (already false when `onClosed` runs). */
  isOpen(): boolean;
  /** The size of the type of the words, px, and whether every line of them is on a page (for the browser checks). */
  type(): { px: number; fits: boolean };
}

// ---- helpers, the same as the generator's ----
const f = (n: number) => String(Math.round(n * 10) / 10);
const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a: string, b: string, t: number) => {
  const A = parse(a);
  const B = parse(b);
  return hex(A.map((v, i) => v + (B[i] - v) * t));
};
const C = { navy: "#132637", court: "#2e92b9", ball: "#d5e645", shade: "#b4c738", white: "#ffffff", quiet: "#9fb0c0", black: "#000000" };
const tint = (t: number) => mix(C.navy, C.white, t);
/** A rectangle with its own radius at each corner: top left, top right, bottom right, bottom left. */
function roundRect(x: number, y: number, w: number, h: number, [tl, tr, br, bl]: number[]): string {
  return `M${f(x + tl)} ${f(y)}H${f(x + w - tr)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + tr)}V${f(y + h - br)}Q${f(x + w)} ${f(y + h)} ${f(x + w - br)} ${f(y + h)}H${f(x + bl)}Q${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - bl)}V${f(y + tl)}Q${f(x)} ${f(y)} ${f(x + tl)} ${f(y)}Z`;
}

const COVER = tint(0.07); // the notebook's cover, the same as in the bag
const PAPER_BACK = mix(C.white, C.quiet, 0.14); // option B's back face: white 86%, quiet
const EDGE_1 = mix(C.white, C.quiet, 0.16);
const EDGE_2 = mix(C.white, C.quiet, 0.4);
const RULE = mix(C.white, C.court, 0.55); // court blue 55%, white

// ---- the notebook, closed: bound along its left side, drawn as the bag draws it ----
const NB = { w: 148, h: 210, rings: 17 };
// the page block shows past the cover up and to the right, the way the scene's camera sees past things: 14 mm back
const PEEK = [Math.cos((40 * Math.PI) / 180) * 14 * 0.35, -Math.sin((40 * Math.PI) / 180) * 14 * 0.35];
const NB_VB = [-14, -8, 172, 222];
function closedNotebook(): string {
  const { w, h, rings } = NB;
  const ring = Array.from({ length: rings }, (_, i) => {
    const cy = 12 + (i * (h - 24)) / (rings - 1);
    return `<rect x="-11" y="${f(cy - 2.4)}" width="20" height="4.8" rx="2.4" fill="${C.white}"/>`;
  }).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${NB_VB.join(" ")}" aria-hidden="true">` +
    `<rect x="${f(PEEK[0])}" y="${f(PEEK[1])}" width="${w}" height="${h}" rx="5" fill="${mix(C.white, C.quiet, 0.3)}"/><rect x="0" y="0" width="${w}" height="${h}" rx="6" fill="${COVER}"/><rect x="${w - 32}" y="0" width="9" height="${h}" fill="${C.ball}"/>${ring}</svg>`
  );
}

// ---- the notebook, open flat: two page blocks on their own boards, the spiral between them ----
/**
 * The shape of the spread. At the design's size (the stills') a page is 308 by 437 with type 20 px on rules 30 px apart. A window too
 * short to show that at a size where the type stays readable (a phone held sideways, where scaling the whole spread down would make the
 * type about 10 px) gets a spread of its own shape instead: pages as big as the window leaves room for, with type of at least
 * PHONE_TYPE px on closer rules, so that the words wrap anew round the bigger type rather than shrinking with the page.
 */
interface Geo {
  PW: number;
  PH: number;
  GUTTER: number;
  /** The cover board showing past the pages: at the outer sides, above, and below, where the page block's edges show too. */
  SIDE: number;
  OVER: number;
  UNDER: number;
  FS: number;
  RULE_GAP: number;
  TEXT_TOP: number;
}
const DESIGN: Geo = { PW: 308, PH: 437, GUTTER: 24, SIDE: 7, OVER: 6, UNDER: 14, FS: 20, RULE_GAP: 30, TEXT_TOP: 34 };
/** The smallest type, px, that the spread is shrunk to before it is given a shape of its own, and that the phone shape sets. */
const PHONE_TYPE = 14;
/** The air round the spread in the phone shape, px (the design shape's is MARGIN). */
const PHONE_MARGIN = 8;

// What follows is set by setGeometry from a Geo (and is read by everything below, so a change of shape reaches all of it).
let PW = 0; // a page, in the closed notebook's 148 by 210
let PH = 0;
let GUTTER = 0;
let SIDE = 0;
let OVER = 0;
let UNDER = 0;
let LP = 0; // the left page's left edge
let RP = 0; // the right page's left edge
let SW = 0; // the spread's size
let SH = 0;
let PT = 0; // the pages' top
// The writing, as option B sets it: lines a rule apart, Caveat's baseline sitting KB of a size below the middle of its line
let FS = 0;
let RULE_GAP = 0;
const KB = 0.33;
let TEXT_TOP = 0;
let TEXT_L = 0;
let TEXT_W = 0;
const ruleY = (n: number) => PT + TEXT_TOP + RULE_GAP * (n + 0.5) + KB * FS + 1;
let RULES: number[] = [];
let HOLES: number[] = [];
// The words in two columns, one on each page's writing area, a line on each rule; the left page fills first.
let COL_GAP = 0;
let TEXT_H = 0;
/** Sizes to try, largest first, until the words fit. */
let SIZES: number[] = [];

function setGeometry(g: Geo): void {
  ({ PW, PH, GUTTER, SIDE, OVER, UNDER, FS, RULE_GAP, TEXT_TOP } = g);
  LP = SIDE;
  RP = SIDE + PW + GUTTER;
  SW = RP + PW + SIDE;
  SH = OVER + PH + UNDER;
  PT = OVER;
  TEXT_L = Math.round(PW * 0.15 + FS * 0.55);
  TEXT_W = Math.round(PW * (1 - 0.15 - 0.08) - FS * 0.55);
  RULES = Array.from({ length: 20 }, (_, n) => ruleY(n)).filter((y) => y < PT + PH - 14);
  HOLES = Array.from({ length: NB.rings }, (_, i) => PT + 25 + (i * (PH - 50)) / (NB.rings - 1));
  COL_GAP = RP - LP - TEXT_W;
  TEXT_H = RULES.length * RULE_GAP;
  SIZES = [FS, FS - 1, FS - 2];
}
setGeometry(DESIGN);

function page(x: number, fill: string, inner: "left" | "right"): string {
  // the spine side gets the small corners
  const r = inner === "right" ? [6, 2, 2, 6] : [2, 6, 6, 2];
  const holeX = inner === "right" ? x + PW - 17 : x + 7;
  return (
    `<path d="${roundRect(x, PT + 6.8, PW, PH, r)}" fill="${EDGE_2}"/><path d="${roundRect(x, PT + 3.4, PW, PH, r)}" fill="${EDGE_1}"/>` +
    `<path d="${roundRect(x, PT, PW, PH, r)}" fill="${fill}"/>` +
    RULES.map((y) => `<rect x="${f(x)}" y="${f(y)}" width="${PW}" height="1.5" fill="${RULE}"/>`).join("") +
    `<rect x="${f(x + Math.round(PW * 0.15))}" y="${PT}" width="2" height="${PH}" fill="${C.shade}"/>` +
    HOLES.map((y) => `<rect x="${f(holeX)}" y="${f(y - 3.5)}" width="10" height="7" rx="3.5" fill="${COVER}"/>`).join("")
  );
}

/** A ball drawn in pen in the margin: a loose navy circle over a lime fill that does not quite stay inside it. */
function doodle(cx: number, cy: number): string {
  const r = 22;
  const pt = (deg: number, rr = r) => [cx + rr * Math.cos((deg * Math.PI) / 180), cy + rr * Math.sin((deg * Math.PI) / 180)];
  // once round and a little past where the pen started
  const [a, b, c] = [pt(-112), pt(70, r + 0.8), pt(260, r - 0.6)];
  const pen = (w: number) => `fill="none" stroke="${C.navy}" stroke-width="${w}" stroke-linecap="round"`;
  return (
    `<circle cx="${f(cx + 2.2)}" cy="${f(cy - 1.6)}" r="${r - 1.5}" fill="${C.ball}"/>` +
    `<path d="M${f(a[0])} ${f(a[1])}A${r} ${r} 0 1 1 ${f(b[0])} ${f(b[1])}A${r + 0.8} ${r + 0.8} 0 1 1 ${f(c[0])} ${f(c[1])}" ${pen(2.2)}/>` +
    `<path d="M${f(cx - 15)} ${f(cy - 15)}Q${f(cx - 4)} ${f(cy)} ${f(cx - 15)} ${f(cy + 15)}M${f(cx + 15)} ${f(cy - 15)}Q${f(cx + 4)} ${f(cy)} ${f(cx + 15)} ${f(cy + 15)}" ${pen(1.9)}/>`
  );
}

/** The paper of the one spread: the covers, the gap the wire spans, both pages, the wire, and room for the doodle. */
function spread(): string {
  const boards =
    `<rect x="${LP + PW}" y="4" width="${GUTTER}" height="${SH - 8}" fill="${mix(C.navy, C.black, 0.3)}"/>` +
    `<path d="${roundRect(0, 0, LP + PW + 2, SH, [9, 3, 3, 9])}" fill="${COVER}"/>` +
    `<path d="${roundRect(RP - 2, 0, PW + SIDE + 2, SH, [3, 9, 9, 3])}" fill="${COVER}"/>`;
  // each turn of the wire runs from a hole on the left page, over the gap, into the hole facing it; round wire, lit from above
  const wire = HOLES.map(
    (y) =>
      `<rect x="${f(LP + PW - 12)}" y="${f(y - 2.3)}" width="${GUTTER + 24}" height="4.6" fill="${C.white}"/><rect x="${f(LP + PW - 12)}" y="${f(y + 1.1)}" width="${GUTTER + 24}" height="1.2" fill="${mix(C.white, C.quiet, 0.6)}"/>`,
  ).join("");
  return (
    `<svg class="v6-nb-paper" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" width="${SW}" height="${SH}" aria-hidden="true">` +
    boards +
    page(LP, PAPER_BACK, "right") +
    page(RP, C.white, "left") +
    wire +
    `<g class="v6-nb-doodle"></g></svg>`
  );
}

/** The site's close chip (index.html), 36 px in a 44 px chip. */
const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;

// ---- the motion ----
// notebookLiftMs (out of the bag to the middle) and notebookSpreadMs (the spread opening out of it) are in params.ts
const SWAP_MS = 50; // first it takes the closed notebook's place, then it grows to its size
const FADE_MS = 180; // with reduced motion: no lift and no scaling, a fade
const LIFT_EASE = "cubic-bezier(0.3, 0.5, 0.2, 1)";
const SPREAD_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
const GROW = 2; // lifted, the notebook is twice its size in the bag
const TURN = -3; // and turned to -3 degrees
/** How far the path bows upward at its middle, as a share of the way: it rises out of the bag before it comes forward.
 * The still nb-lift.png has it 46 px over the straight line 45% of the way along a 292 px trip. */
const BOW = 0.16;
/** The toy behind: blurred 2 px under a 0.1 navy veil while the notebook lifts, 5 px under 0.3 once it is open. */
const veil = (blur: number, dim: number): Keyframe => ({ backdropFilter: `blur(${blur}px)`, backgroundColor: `rgba(19, 38, 55, ${dim})` });

// ---- the fit ----
const MARGIN = 24;
const MAX_SCALE = 1.3;
/** The close chip's corner of the window, with a little room around it: 12 px in, 44 px across, 8 px clear. */
const CHIP_ZONE = 12 + 44 + 8;

interface Fit {
  s: number;
  left: number;
  top: number;
}

/**
 * Where the spread goes in a `w` by `h` window: its scale and its top left corner, px. The stills show it at its design
 * size on a 1280 x 800 page; a bigger window grows it with the window, up to 1.3x, and a smaller one shrinks it to fit
 * with 24 px margins. It keeps clear of the close chip: if centred it would run under the chip, it moves below the chip's
 * row or left of its column, whichever leaves it bigger.
 */
function place(w: number, h: number, margin = MARGIN): Fit {
  const cap = Math.min(MAX_SCALE, Math.max(1, Math.min(w / 1280, h / 800)));
  const boxes = [
    [margin, margin, w - margin, h - margin],
    [margin, CHIP_ZONE, w - margin, h - margin],
    [margin, margin, w - CHIP_ZONE, h - margin],
  ];
  const fits = boxes.map(([x0, y0, x1, y1]) => {
    const s = Math.max(0.1, Math.min(cap, (x1 - x0) / SW, (y1 - y0) / SH));
    const left = Math.round(Math.max(x0, Math.min((w - SW * s) / 2, x1 - SW * s)));
    const top = Math.round(Math.max(y0, Math.min((h - SH * s) / 2, y1 - SH * s)));
    const clear = left + SW * s <= w - CHIP_ZONE + 1 || top >= CHIP_ZONE - 1;
    return { s, left, top, clear };
  });
  const clear = fits.filter((it) => it.clear);
  return (clear.length ? clear : fits).reduce((best, it) => (it.s > best.s + 1e-6 ? it : best));
}

/**
 * The shape of the spread for a `w` by `h` window: the design's, unless that would have to be shrunk until its type is under PHONE_TYPE px,
 * and then pages as big as the window leaves room for (clear of the close chip, which takes the top right corner), thin cover, and type of
 * PHONE_TYPE px on rules 21 px apart.
 */
function geometryFor(w: number, h: number): Geo {
  setGeometry(DESIGN);
  if (place(w, h).s * DESIGN.FS >= PHONE_TYPE) return DESIGN;
  const SIDE = 3;
  const OVER = 3;
  const UNDER = 6;
  const GUTTER = 16;
  const PW = Math.floor((w - CHIP_ZONE - PHONE_MARGIN - 2 * SIDE - GUTTER) / 2);
  const PH = Math.floor(h - 2 * PHONE_MARGIN - OVER - UNDER);
  return { PW: Math.min(PW, DESIGN.PW), PH: Math.min(PH, DESIGN.PH), GUTTER, SIDE, OVER, UNDER, FS: PHONE_TYPE, RULE_GAP: 21, TEXT_TOP: 24 };
}

export function mountNotebook(opts: { onClosed(): void; onOpened?(): void; reducedMotion: boolean }): Notebook {
  const dialog = document.createElement("dialog");
  dialog.className = "v6-notebook";
  dialog.setAttribute("aria-label", "Notebook");
  dialog.innerHTML =
    `<button type="button" class="chip v6-nb-close" aria-label="Close the notebook" title="Close">${CLOSE_ICON}</button>` +
    `<div class="v6-nb-closed">${closedNotebook()}</div>` +
    `<div class="v6-nb-fit"><div class="v6-nb-spread"></div></div>`;
  const chip = dialog.querySelector<HTMLButtonElement>(".v6-nb-close")!;
  const closed = dialog.querySelector<HTMLElement>(".v6-nb-closed")!;
  const fitBox = dialog.querySelector<HTMLElement>(".v6-nb-fit")!;
  const spreadBox = dialog.querySelector<HTMLElement>(".v6-nb-spread")!;
  let doodleBox!: SVGGElement;
  let text!: HTMLElement;
  let shape: Geo = DESIGN;
  /** Draw the spread in the shape `g` (which is also what everything below reads: see setGeometry). */
  function render(g: Geo): void {
    shape = g;
    setGeometry(g);
    spreadBox.innerHTML = `${spread()}<p class="v6-nb-text"></p>`;
    doodleBox = spreadBox.querySelector<SVGGElement>(".v6-nb-doodle")!;
    text = spreadBox.querySelector<HTMLElement>(".v6-nb-text")!;
    text.textContent = NOTEBOOK_TEXT;
    Object.assign(fitBox.style, { width: `${SW}px`, height: `${SH}px` });
    // the spread opens out of the closed notebook, its right page where the cover was: it turns and grows about that page
    spreadBox.style.transformOrigin = `${RP + PW / 2}px ${PT + PH / 2}px`;
    Object.assign(text.style, {
      left: `${LP + TEXT_L}px`,
      width: `${2 * TEXT_W + COL_GAP}px`,
      height: `${TEXT_H}px`,
      columnGap: `${COL_GAP}px`,
      lineHeight: `${RULE_GAP}px`,
    });
    setFont(FS);
  }
  document.body.append(dialog);

  let state: "closed" | "opening" | "open" | "closing" = "closed";
  let box: NotebookBox | null = null;
  let back: HTMLElement | null = null;
  let fit: Fit = { s: 1, left: 0, top: 0 };
  let anims: Animation[] = [];
  let run = 0;
  let fontPx = FS;
  let fitsNow = true;
  let pressedOutside = false;

  function setFont(px: number): void {
    fontPx = px;
    text.style.fontSize = `${px}px`;
    // Caveat's baseline sits KB of a size below the middle of its line: keep it on the rule at any size
    text.style.top = `${PT + TEXT_TOP + KB * (FS - px)}px`;
  }
  render(DESIGN);

  /** The words' line boxes, in the spread's own px from the text's top left corner. Read with the spread unturned. */
  function lineBoxes() {
    const outer = text.getBoundingClientRect();
    const k = outer.width / text.offsetWidth || 1;
    const range = document.createRange();
    range.selectNodeContents(text);
    return Array.from(range.getClientRects())
      .filter((r) => r.width > 0.5)
      .map((r) => ({ x0: (r.left - outer.left) / k, x1: (r.right - outer.left) / k, y0: (r.top - outer.top) / k, y1: (r.bottom - outer.top) / k }));
  }

  /** Whether every line of the words is on one of the two pages' writing areas, none spilling or cut off. */
  function textFits(): boolean {
    if (text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1) return false;
    const right = TEXT_W + COL_GAP;
    return lineBoxes().every(
      (b) => b.y0 >= -1 && b.y1 <= TEXT_H + 1 && b.x0 >= -1 && (b.x1 <= TEXT_W + 1 || (b.x0 >= right - 1 && b.x1 <= right + TEXT_W + 1)),
    );
  }

  /** Set the words at the largest size that fits, then draw the ball two rules under them if the right page has room. */
  function measure(): void {
    for (const px of SIZES) {
      setFont(px);
      fitsNow = textFits();
      if (fitsNow) break;
    }
    const lines = lineBoxes();
    const last = lines[lines.length - 1];
    const line = last ? Math.floor((last.y0 + last.y1) / 2 / RULE_GAP) : RULES.length;
    const onRight = !!last && last.x0 >= TEXT_W + COL_GAP / 2;
    // as in the stills: the last line on rule n, the ball sits on rule n + 3, which has to be on the page
    doodleBox.innerHTML = fitsNow && onRight && line + 3 < RULES.length ? doodle(RP + 150, ruleY(line + 3) - 23) : "";
  }

  function layout(): void {
    const [w, h] = [dialog.clientWidth || innerWidth, dialog.clientHeight || innerHeight];
    const wanted = geometryFor(w, h);
    const changed = JSON.stringify(wanted) !== JSON.stringify(shape);
    if (changed) render(wanted);
    else setGeometry(shape); // geometryFor tried the design's shape
    fit = place(w, h, wanted === DESIGN ? MARGIN : PHONE_MARGIN);
    fitBox.style.transform = `translate(${fit.left}px, ${fit.top}px) scale(${fit.s})`;
  }

  /**
   * The opening, start to end, as animations that all end at the same moment, so the closing can play them backward
   * together. Their end is the open state the stylesheet already holds.
   */
  function build(from: NotebookBox): Animation[] {
    if (opts.reducedMotion) {
      const fade: KeyframeAnimationOptions = { duration: FADE_MS, easing: "ease", fill: "both" };
      return [
        dialog.animate([veil(0, 0), veil(params.notebookBlur, params.notebookVeil)], fade),
        spreadBox.animate([{ opacity: 0 }, { opacity: 1 }], fade),
        chip.animate([{ opacity: 0 }, { opacity: 1 }], fade),
      ];
    }
    const { s, left, top } = fit;
    const [cx, cy] = [left + (SW * s) / 2, top + (SH * s) / 2]; // where it ends: the spread's middle
    const k = (from.width / NB.w + from.height / NB.h) / 2; // px to the notebook's unit, in the bag
    const kEnd = Math.min(GROW * k, (PH * s) / NB.h); // lifted; never bigger than a page of the spread
    // the closed notebook is laid out at its lifted size with its middle on the spread's middle, and starts in the bag
    const [vx, vy, vw, vh] = NB_VB;
    const [ox, oy] = [(NB.w / 2 - vx) * kEnd, (NB.h / 2 - vy) * kEnd];
    Object.assign(closed.style, {
      left: `${cx - ox}px`,
      top: `${cy - oy}px`,
      width: `${vw * kEnd}px`,
      height: `${vh * kEnd}px`,
      transformOrigin: `${ox}px ${oy}px`,
    });
    // the path: a curve from the bag to the middle whose control point is raised, so it bows upward
    const [x0, y0] = [from.x, from.y];
    const [qx, qy] = [(x0 + cx) / 2, (y0 + cy) / 2 - 2 * BOW * Math.hypot(cx - x0, cy - y0)];
    const path: Keyframe[] = Array.from({ length: 17 }, (_, i) => {
      const p = i / 16;
      const near = 1 - (1 - p) ** 4; // it comes up toward you and turns first, then glides to the middle
      const x = (1 - p) ** 2 * x0 + 2 * p * (1 - p) * qx + p * p * cx;
      const y = (1 - p) ** 2 * y0 + 2 * p * (1 - p) * qy + p * p * cy;
      const scale = (k + (kEnd - k) * near) / kEnd;
      const turn = from.tilt + (TURN - from.tilt) * near;
      return { offset: p, transform: `translate(${(x - cx).toFixed(2)}px, ${(y - cy).toFixed(2)}px) rotate(${turn.toFixed(3)}deg) scale(${scale.toFixed(4)})` };
    });
    // the spread starts as big as the lifted notebook, its right page over it and turned with it
    const s0 = (NB.h * kEnd) / (PH * s);
    const from0 = `translate(${SW / 2 - (RP + PW / 2)}px, ${SH / 2 - (PT + PH / 2)}px) rotate(${TURN}deg) scale(${s0.toFixed(4)})`;
    const LIFT_MS = params.notebookLiftMs;
    const SPREAD_MS = params.notebookSpreadMs;
    const total = LIFT_MS + SPREAD_MS;
    return [
      dialog.animate(
        [
          { offset: 0, ...veil(0, 0), easing: "ease-out" },
          { offset: 120 / total, ...veil(2, 0.1) },
          { offset: LIFT_MS / total, ...veil(2, 0.1), easing: "ease-in-out" },
          { offset: 1, ...veil(params.notebookBlur, params.notebookVeil) },
        ],
        { duration: total, fill: "both" },
      ),
      closed.animate(path, { duration: LIFT_MS, endDelay: SPREAD_MS, easing: LIFT_EASE, fill: "both" }),
      // the spread fades in over it, the cover giving way to the page; it has gone before the spread moves
      closed.animate([{ opacity: 1 }, { opacity: 0 }], { delay: LIFT_MS + 20, duration: SWAP_MS - 20, endDelay: SPREAD_MS - SWAP_MS, fill: "both" }),
      spreadBox.animate([{ opacity: 0 }, { opacity: 1 }], { delay: LIFT_MS, duration: SWAP_MS, endDelay: SPREAD_MS - SWAP_MS, easing: "ease-out", fill: "both" }),
      spreadBox.animate(
        [
          { offset: 0, transform: from0 },
          { offset: SWAP_MS / SPREAD_MS, transform: from0, easing: SPREAD_EASE },
          { offset: 1, transform: "translate(0px, 0px) rotate(0deg) scale(1)" },
        ],
        { delay: LIFT_MS, duration: SPREAD_MS, fill: "both" },
      ),
      chip.animate([{ opacity: 0 }, { opacity: 1 }], { delay: LIFT_MS, duration: SPREAD_MS, fill: "both" }),
    ];
  }

  /** Run `then` once the running animations are done, unless something else has happened since. */
  function settle(then: () => void): void {
    const mine = ++run;
    Promise.all(anims.map((a) => a.finished)).then(
      () => {
        if (mine === run) then();
      },
      () => {},
    );
  }

  function open(from: NotebookBox, opener?: HTMLElement): void {
    if (state !== "closed") return;
    box = from;
    back = opener ?? null;
    state = "opening";
    pressedOutside = false;
    if (!dialog.open) dialog.showModal();
    layout();
    measure();
    anims = build(from);
    settle(() => {
      state = "open";
      // the end of every animation is the stylesheet's open state: let it go
      for (const a of anims) a.cancel();
      anims = [];
      measure();
      opts.onOpened?.();
    });
    chip.focus({ preventScroll: true });
  }

  function close(): void {
    if (state === "closed" || state === "closing") return;
    if (state === "open") {
      // played backward from the end, laid out for the window as it is now
      layout();
      anims = build(box!);
    }
    state = "closing";
    for (const a of anims) a.reverse();
    settle(finish);
  }

  function finish(): void {
    state = "closed";
    run++;
    for (const a of anims) a.cancel();
    anims = [];
    if (dialog.open) dialog.close();
    opts.onClosed();
    back?.focus({ preventScroll: true });
    back = null;
  }

  const isOpen = () => state !== "closed";

  chip.addEventListener("click", () => close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state !== "closed") {
      e.preventDefault();
      close();
    }
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  // closed by the browser itself (a second Escape while it closes, say): put everything away at once
  dialog.addEventListener("close", () => {
    if (state !== "closed") finish();
  });
  // A click on the dimmed toy around the spread closes it, as with the credits. The press has to start out there too.
  // While it is still lifting, a click there is more likely the second half of a double click on the bag: ignored.
  const inside = (target: EventTarget | null) => target instanceof Node && (spreadBox.contains(target) || closed.contains(target));
  dialog.addEventListener("pointerdown", (e) => (pressedOutside = !inside(e.target)));
  dialog.addEventListener("click", (e) => {
    if (state === "open" && pressedOutside && !inside(e.target)) close();
  });
  addEventListener("resize", () => {
    if (state !== "open") return;
    layout();
    measure();
  });
  // Caveat loads when something first uses it; ask for it now so the words are measured in it
  document.fonts.load(`500 ${FS}px Caveat`, NOTEBOOK_TEXT).then(
    () => {
      if (state === "open") measure();
    },
    () => {},
  );

  const type = () => ({ px: fontPx, fits: state === "open" ? textFits() : fitsNow });

  return { open, close, isOpen, type };
}
