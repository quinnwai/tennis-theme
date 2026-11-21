/**
 * The v6 scene's art, drawn at runtime: a port of design/v6/gen6.mjs, the generator for the approved v6 canvas.
 * Millimeters throughout, y down. One camera (receding edges run up and to the right at 40 degrees, depths drawn at
 * 0.35 of their length) and one light (nearly overhead, a touch to the right). Flat tones, no outlines.
 *
 * Every function returns SVG markup. The bag is split into the part behind what stands in it (`bagBack`) and the part
 * in front (`bagFront`), so the cans and the notebook can rise out of it between the two, and both take the zip's
 * progress (0 closed, 1 open) so the zip can follow a finger.
 */
import SEAM_RAW from "../../design/seam.txt?raw";

export type P = [number, number];

const SEAM = SEAM_RAW.trim();

// ---- helpers ----
const f = (n: number) => String(Math.round(n * 10) / 10);
const f4 = (n: number) => String(Math.round(n * 10000) / 10000);
const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
export const mix = (a: string, b: string, t: number) => {
  const A = parse(a);
  const B = parse(b);
  return hex(A.map((v, i) => v + (B[i] - v) * t));
};
export const C = {
  navy: "#132637",
  court: "#2e92b9",
  ball: "#d5e645",
  shade: "#b4c738",
  white: "#ffffff",
  quiet: "#9fb0c0",
  black: "#000000",
};
export const tint = (t: number) => mix(C.navy, C.white, t);
export const deep = (t: number) => mix(C.navy, C.black, t);
export const SHADOW = deep(0.55);
export const SHADOW_OPACITY = 0.45;

let uid = 0;
const id = (p: string) => `v6${p}${++uid}`;
export const poly = (pts: P[], close = true) => "M" + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join("L") + (close ? "Z" : "");
const shift = (pts: P[], dx: number, dy: number): P[] => pts.map((p) => [p[0] + dx, p[1] + dy]);
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function cubicAt(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const u = 1 - t;
  const at = (i: 0 | 1) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
  return [at(0), at(1)];
}
const seg = (p0: P, c1: P, c2: P, p3: P) => (t: number) => cubicAt(p0, c1, c2, p3, t);

export function hull(points: P[]): P[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** A ball exactly as the toy draws one: lit from the upper right. */
function ball(cx: number, cy: number, r: number, angle = 0): string {
  const k = id("bc");
  return `<g transform="translate(${f(cx)} ${f(cy)})"><clipPath id="${k}"><circle r="${f(r)}"/></clipPath><circle r="${f(r)}" fill="${C.shade}"/><g clip-path="url(#${k})"><circle cx="${f(r * 0.12)}" cy="${f(-r * 0.12)}" r="${f(r)}" fill="${C.ball}"/><path d="${SEAM}" transform="rotate(${angle}) scale(${f(r)})" fill="${C.white}"/></g></g>`;
}

// ---- camera ----
const DEPTH_ANGLE = 40;
const DEPTH_SCALE = 0.35;
export const DEPTH_DIR: P = [Math.cos((DEPTH_ANGLE * Math.PI) / 180), -Math.sin((DEPTH_ANGLE * Math.PI) / 180)];
/** How a depth of `mm` straight back from the viewer shows on screen. */
export const depth = (mm: number): P => [DEPTH_DIR[0] * mm * DEPTH_SCALE, DEPTH_DIR[1] * mm * DEPTH_SCALE];
/** A flat circle lying level shows as an ellipse sheared by this many degrees (skewX) under this camera. */
export const SKEW = (Math.atan2(DEPTH_DIR[0], -DEPTH_DIR[1]) * 180) / Math.PI;

// ---- light ----
/** The way the light travels for each millimeter it drops: a touch to the left, nothing from the front. */
export const LIGHT: [number, number, number] = [-0.08, -1, 0];

/** An SVG's viewBox and contents, to place on the page. */
export interface Art {
  vb: [number, number, number, number];
  body: string;
}

// ---- the bag: long and slim like the Wilson bags, about 2.7 times as long as its front is tall ----
export const BAG_VB: Art["vb"] = [-180, -500, 1120, 540];
/** The point of the bag placed on the page: its front's bottom edge, 390 mm from the handle end. */
export const BAG_ANCHOR: P = [390, 0];
/** The bag is about 30 cm deep. */
export const BAG_D = depth(300);
const D = BAG_D;
const F_START: P = [70, 0];
const F: { cmd: "L" | "C"; pts: P[] }[] = [
  { cmd: "L", pts: [[640, 0]] },
  { cmd: "C", pts: [[712, 0], [782, -52], [782, -142]] },
  { cmd: "C", pts: [[782, -236], [716, -290], [620, -292]] },
  { cmd: "C", pts: [[450, -295], [262, -278], [150, -264]] },
  { cmd: "C", pts: [[60, -253], [0, -206], [0, -138]] },
  { cmd: "C", pts: [[0, -56], [26, 0], [70, 0]] },
];
const F_PATH =
  `M${F_START[0]} ${F_START[1]}` + F.map(({ cmd, pts }) => cmd + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join(" ")).join("") + "Z";
export function sampleF(n = 28): P[] {
  const out: P[] = [F_START];
  let at = F_START;
  for (const { cmd, pts } of F) {
    if (cmd === "L") out.push(pts[0]);
    else for (let i = 1; i <= n; i++) out.push(cubicAt(at, pts[0], pts[1], pts[2], i / n));
    at = pts[pts.length - 1];
  }
  return out;
}
const DOME_UP = seg([782, -142], [782, -236], [716, -290], [620, -292]);
const TOP = seg([620, -292], [450, -295], [262, -278], [150, -264]);
const END_UP = seg([150, -264], [60, -253], [0, -206], [0, -138]);
const TE: P[] = (() => {
  const pts: P[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) pts.push(DOME_UP(0.2 + (0.8 * i) / n));
  for (let i = 1; i <= n; i++) pts.push(TOP(i / n));
  for (let i = 1; i <= n; i++) pts.push(END_UP((0.85 * i) / n));
  return pts;
})();
const TE_LR = [...TE].reverse();
/** The top edge, `dp` of the way back across the top (0 its front edge, 1 its back), from u0 to u1 along it. */
function along(dp: number, u0 = 0, u1 = 1): P[] {
  const pts = shift(TE_LR, D[0] * dp, D[1] * dp);
  return pts.slice(Math.round(u0 * (pts.length - 1)), Math.round(u1 * (pts.length - 1)) + 1);
}
const atU = (dp: number, u: number) => along(dp, u, u)[0];
/** A point on the top: u runs along the front top edge from the handle end (0) to the head end (1), dp from the front
 * of the top (0) to its back (1). */
function surf(u: number, dp: number): P {
  const n = TE_LR.length - 1;
  const i = Math.max(0, Math.min(n - 1e-6, u * n));
  const i0 = Math.floor(i);
  const p = lerp(TE_LR[i0], TE_LR[i0 + 1], i - i0);
  return [p[0] + D[0] * dp, p[1] + D[1] * dp];
}
function uAtX(x: number): number {
  let best = 0;
  TE_LR.forEach((p, i) => {
    if (Math.abs(p[0] - x) < Math.abs(TE_LR[best][0] - x)) best = i;
  });
  return best / (TE_LR.length - 1);
}
/** The front top edge's height at x, bag mm. */
export const frontTopAt = (x: number) => atU(0, uAtX(x))[1];

// Flat tones only, no outlines: faces are told apart by how much light they get.
const BAG = {
  front: deep(0.28),
  pocket: deep(0.14),
  end: tint(0.07), // the right end, above its widest line, catches a little of the light
  endShade: deep(0.2), // below it, turning down toward the bench, it does not
  top1: tint(0.13),
  top2: tint(0.16),
  top3: tint(0.11),
  // the handle is the bag's own fabric: the padded loop a step lighter than the top it stands off, its tabs sewn flat
  strap: tint(0.21),
  tab: tint(0.185),
  stitch: tint(0.3),
  base: deep(0.6),
  slot: deep(0.62),
  pullTonal: tint(0.34),
  inner: deep(0.62),
};
const MAIN_ZIP = 0.18;
/** How much lower than v4 the cans and notebook stop when they pop up, so at real size they stay clear of the name. */
const POP_DROP = 60;

function limePull(x: number, y: number, slant: number): string {
  return `<g transform="translate(${f(x)} ${f(y)})"><g transform="rotate(${f(slant)}) scale(1.3)"><rect x="-11" y="-7" width="22" height="14" rx="4" fill="${mix(C.shade, C.navy, 0.15)}"/></g><g transform="scale(1.3)"><rect x="-8.5" y="1" width="17" height="46" rx="8.5" fill="${C.shade}"/><rect x="-6" y="1" width="14.5" height="43.5" rx="7.25" fill="${C.ball}"/><circle cx="1.2" cy="34" r="3.4" fill="${deep(0.4)}"/></g></g>`;
}
/** The pocket's pull: its slider turned to lie along the zip, the tab hanging from it with a hole like the lime pull's. */
function tonalPull(x: number, y: number, slant: number): string {
  return `<g transform="translate(${f(x)} ${f(y)})"><rect x="-7" y="-4.5" width="14" height="9" rx="3" fill="${BAG.pullTonal}" transform="rotate(${f(slant)})"/><rect x="-5" y="2" width="10" height="26" rx="5" fill="${BAG.pullTonal}"/><circle cx="0" cy="21" r="2.1" fill="${deep(0.4)}"/></g>`;
}
/** The main zip and the pocket zip: a court-blue line with a dark slot down its middle. */
function blueZip(pts: P[], w = 6): string {
  const d = poly(pts, false);
  return `<path d="${d}" fill="none" stroke="${C.court}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${BAG.slot}" stroke-width="${f(w * 0.36)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A clear can of balls standing on (0, 0), holding `balls` of its three. Frosted enough that what is behind it does
 * not draw through. */
export function can(seed: number, balls = 3): string {
  const [w, h, cap, r] = [74, 240, 26, 33.5];
  const top = cap - h;
  const inside = [0, 1, 2]
    .filter((i) => i >= 3 - balls)
    .map((i) => ball(0, top + 3.5 + r + i * 2 * r, r, (seed * 83 + i * 137) % 360))
    .join("");
  return `<rect x="${-w / 2}" y="${top}" width="${w}" height="${-top}" rx="9" fill="${tint(0.1)}"/>${inside}<rect x="${-w / 2}" y="${top}" width="${w}" height="${-top}" rx="9" fill="${C.white}" fill-opacity="0.2"/><rect x="${w / 2 - 14}" y="${top + 12}" width="6" height="${-top - 26}" rx="3" fill="${C.white}" fill-opacity="0.4"/><rect x="${-w / 2 - 2.5}" y="${-h}" width="${w + 5}" height="${cap}" rx="6" fill="${mix(C.white, C.quiet, 0.22)}"/><rect x="${-w / 2 - 2.5}" y="${-h + cap - 8}" width="${w + 5}" height="8" rx="3" fill="${mix(C.white, C.quiet, 0.55)}"/><ellipse cx="0" cy="0" rx="${(w + 5) / 2}" ry="${f((w + 5) * 0.5 * -DEPTH_DIR[1] * DEPTH_SCALE)}" transform="translate(0 ${-h}) skewX(${f(-SKEW)})" fill="${C.white}"/>`;
}
/** A can's size with its lid: 79 wide, 249 tall from its foot to the top of the lid's ellipse. */
export const CAN = { w: 79, h: 249, body: 240, r: 33.5 };
/** A can on its own, to draw on the toy's canvas once it is out of the bag. Its viewBox is 84 x 256 mm, and the middle
 * of the can (lid included) is 42 mm in from its left and 127.5 mm down from its top. */
export const CAN_IMAGE = { w: 84, h: 256, ox: 42, oy: 252 - CAN.h / 2 };
export function canImage(seed: number, balls: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-42 -252 84 256" width="84" height="256">${can(seed, balls)}</svg>`;
}

/** The notebook, bound down its left side: white wire loops over the spine, the page block showing at the top and right
 * where the camera sees past the cover, a ball-green band near the right edge. 148 x 210, standing on (0, 0). */
export function notebookArt(): string {
  const [w, h] = [148, 210];
  const [px, py] = depth(14);
  const loops = 17;
  const rings = Array.from({ length: loops }, (_, i) => {
    const y = -h + 12 + (i * (h - 24)) / (loops - 1);
    return `<rect x="${-w / 2 - 11}" y="${f(y - 2.4)}" width="20" height="4.8" rx="2.4" fill="${C.white}"/>`;
  }).join("");
  return `<rect x="${f(-w / 2 + px)}" y="${f(-h + py)}" width="${w}" height="${h}" rx="5" fill="${mix(C.white, C.quiet, 0.3)}"/><rect x="${-w / 2}" y="${-h}" width="${w}" height="${h}" rx="6" fill="${tint(0.07)}"/><rect x="${w / 2 - 32}" y="${-h}" width="9" height="${h}" fill="${C.ball}"/>${rings}`;
}
export const NOTEBOOK = { w: 148, h: 210 };

/** The handle: one padded loop in the bag's own fabric, its ends sewn down on the middle of the top under stitched tabs,
 * arching a little between them. Drawn as one band of even width, a step lighter than the top; the tabs lie flush. */
function handles(): string {
  const uA = uAtX(292);
  const uB = uAtX(488);
  const DP = 0.5;
  const LIFT = 40; // how far the middle of the loop stands off the top, mm
  const WIDTH = 9; // the padded strap, as the camera sees it, mm
  const centre = Array.from({ length: 41 }, (_, i): P => {
    const s = i / 40;
    const p = surf(uA + (uB - uA) * s, DP);
    return [p[0], p[1] - LIFT * Math.sin(Math.PI * s) ** 0.85];
  });
  const quad = (u: number, dp: number, du: number, dd: number) => [
    surf(u - du, dp - dd),
    surf(u + du, dp - dd),
    surf(u + du, dp + dd),
    surf(u - du, dp + dd),
  ];
  const tabs = [uA, uB]
    .map(
      (u) =>
        `<path d="${poly(quad(u, DP, 0.026, 0.085))}" fill="${BAG.tab}"/><path d="${poly(quad(u, DP, 0.018, 0.055))}" fill="none" stroke="${BAG.stitch}" stroke-width="1.2" stroke-dasharray="4 3"/>`,
    )
    .join("");
  return `<path d="${poly(centre, false)}" fill="none" stroke="${BAG.strap}" stroke-width="${WIDTH}" stroke-linejoin="round"/>` + tabs;
}

/** The pocket at the handle end: narrow and full height, its top following the bag's top, its zip along the top. */
function pocket(): string {
  const x0 = 92;
  const x1 = 232;
  const top = TE_LR.filter((p) => p[0] >= x0 && p[0] <= x1).map((p): P => [p[0], p[1] + 18]);
  const tl = top[0];
  const tr = top[top.length - 1];
  const path =
    `M${f(tl[0])} ${f(tl[1])}` +
    top
      .slice(1)
      .map((p) => `L${f(p[0])} ${f(p[1])}`)
      .join("") +
    `L${f(tr[0] + 6)} 6L${f(x0 - 36)} 6C${f(x0 - 40)} -60 ${f(x0 - 26)} ${f(tl[1] + 70)} ${f(tl[0])} ${f(tl[1])}Z`;
  const zipLine = top
    .filter((_, i) => i % 2 === 0)
    .map((p): P => [p[0], p[1] + 11])
    .slice(1, -1);
  // the pull sits on the zip a little way in from its end, so the track shows on both sides of the slider
  const i = Math.round((zipLine.length - 1) * 0.22);
  const [a, b] = [zipLine[i - 1], zipLine[i + 1]];
  const slant = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return `<path d="${path}" fill="${BAG.pocket}"/>${blueZip(zipLine, 5)}${tonalPull(zipLine[i][0], zipLine[i][1], slant)}`;
}

export interface Item {
  kind: "can" | "notebook";
  /** The middle of its foot once it is up, bag mm, and its tilt in degrees. */
  x: number;
  y: number;
  tilt: number;
  seed: number;
}
/** What pops up out of the open bag: three cans and the notebook. */
export const ITEMS: Item[] = [
  { kind: "can", x: 236, y: -222 + POP_DROP, tilt: -8, seed: 1 },
  { kind: "can", x: 322, y: -228 + POP_DROP, tilt: -3, seed: 2 },
  { kind: "can", x: 408, y: -226 + POP_DROP, tilt: 2, seed: 3 },
  { kind: "notebook", x: 548, y: -240 + POP_DROP, tilt: 7, seed: 0 },
];
/** How far down an item has to sink to be out of sight behind the bag's front, mm. */
export function sinkDepth(it: Item): number {
  const h = it.kind === "can" ? CAN.h : NOTEBOOK.h;
  return frontTopAt(it.x) - (it.y - h) + 14;
}

/** The zip's progress (0 closed, 1 open) as a place along the bag's top edge. */
const zipU = (zip: number) => 0.1 + (0.97 - 0.1) * zip;
/** Where the lime pull is for a given progress, bag mm, and how its slider is turned. */
export function pullAt(zip: number): { x: number; y: number; slant: number } {
  const u = zipU(zip);
  const p = atU(MAIN_ZIP, u);
  const slant = u <= 0.85 ? -6 + 2 * ((u - 0.1) / 0.75) : -4 + 34 * ((u - 0.85) / 0.12);
  return { x: p[0], y: p[1], slant };
}

/** Everything of the bag behind what stands in it: its shadow, its right end, its top, the handle, the zip or the
 * opening. */
export function bagBack(zip: number): string {
  const k = id("bag");
  const fPts = sampleF();
  const hullPts = hull([...fPts, ...shift(fPts, D[0], D[1])]);
  let b = "";
  // its shadow: with the light nearly overhead it is the bag's plan, out to the furthest point of each bulging end and
  // nudged left by the height that point is at, so it shows only under the rounded ends
  const sx = fPts.map(([x, y]) => x + (LIGHT[0] / -LIGHT[1]) * -y);
  const [s0, s1] = [Math.min(...sx), Math.max(...sx)];
  const R = 55;
  const plan: P[] = [];
  (
    [
      [s1 - R, R, -90],
      [s1 - R, 300 - R, 0],
      [s0 + R, 300 - R, 90],
      [s0 + R, R, 180],
    ] as const
  ).forEach(([cx, cz, a0]) => {
    for (let i = 0; i <= 8; i++) {
      const a = ((a0 + (90 * i) / 8) * Math.PI) / 180;
      const [x, z] = [cx + R * Math.cos(a), cz + R * Math.sin(a)];
      plan.push([x + depth(z)[0], depth(z)[1]]);
    }
  });
  b += `<path d="${poly(plan)}" fill="${SHADOW}" fill-opacity="0.38"/>`;
  // the right end: lit above its widest line, in shade below it where it turns down toward the bench
  const eq: P = [782, -142];
  const ea: P = [eq[0] - 3 * D[0], eq[1] - 3 * D[1]];
  const eb: P = [eq[0] + 3 * D[0], eq[1] + 3 * D[1]];
  b += `<clipPath id="${k}e"><path d="${poly([ea, eb, [eb[0], eb[1] - 2000], [ea[0], ea[1] - 2000]])}"/></clipPath><path d="${poly(hullPts)}" fill="${BAG.endShade}"/><path d="${poly(hullPts)}" fill="${BAG.end}" clip-path="url(#${k}e)"/>`;
  // the top in three tonal strips: the compartments are only implied, so nothing pulls the eye off the outline
  const strip = (a: number, z: number, fill: string) =>
    `<path d="${poly([...shift(TE, D[0] * a, D[1] * a), ...shift(TE, D[0] * z, D[1] * z).reverse()])}" fill="${fill}"/>`;
  b += strip(0, 0.36, BAG.top1) + strip(0.36, 0.7, BAG.top2) + strip(0.7, 1, BAG.top3);
  b += handles();

  if (zip <= 0) {
    b += blueZip(along(MAIN_ZIP, 0.04, 0.97), 7);
  } else {
    const upTo = zipU(zip);
    const n = Math.max(2, Math.round((upTo - 0.04) * (TE_LR.length - 1)));
    // part way, the opening is a narrow slit; all the way, it gapes
    const e = zip <= 0.6 ? 0.8 : 0.8 - 0.3 * ((zip - 0.6) / 0.4);
    const front: P[] = [];
    const back: P[] = [];
    const lining: P[] = [];
    for (let i = 0; i <= n; i++) {
      const u = 0.04 + (upTo - 0.04) * (i / n);
      const s = Math.sin(Math.PI * (i / n)) ** e;
      front.push(atU(MAIN_ZIP - 0.16 * s, u));
      const bk = atU(MAIN_ZIP + 0.18 * s, u);
      back.push([bk[0], bk[1] - 18 * s]);
      lining.push([bk[0], bk[1] - 18 * s + 14 * Math.min(1, s * 1.5)]);
    }
    b += `<path d="${poly([...back, ...[...front].reverse()])}" fill="${BAG.inner}"/>`;
    b += `<path d="${poly([...back, ...[...lining].reverse()])}" fill="${C.court}"/>`;
    if (upTo < 0.96) b += blueZip(along(MAIN_ZIP, upTo, 0.97), 7);
  }
  return b;
}

/** Everything of the bag in front of what stands in it: the front panel, the pocket, the piping and the lime pull. */
export function bagFront(zip: number): string {
  const k = id("bagf");
  const p = pullAt(zip);
  return (
    `<defs><clipPath id="${k}"><path d="${F_PATH}"/></clipPath></defs>` +
    `<path d="${F_PATH}" fill="${BAG.front}"/>` +
    `<g clip-path="url(#${k})">${pocket()}<rect x="-10" y="-20" width="820" height="30" fill="${BAG.base}"/></g>` +
    `<path d="M430 -274C520 -278 580 -276 618 -273C710 -270 766 -222 766 -142C766 -60 712 -18 646 -18" fill="none" stroke="${C.court}" stroke-width="6" stroke-linecap="round"/>` +
    limePull(p.x, p.y, p.slant)
  );
}

/** The bag's outline half way back, where the balls are: what they land on. Bag mm. */
export function bagOutline(): P[] {
  return hull(shift(sampleF(), D[0] * 0.5, D[1] * 0.5));
}
/** The top of the bag's outline at x (bag mm), half way back, or null past its ends. */
export function bagTopAt(x: number): number | null {
  const pts = along(0.5);
  if (x < pts[0][0] || x > pts[pts.length - 1][0]) return null;
  let best = pts[0];
  for (const p of pts) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
  return best[1];
}

// ---- the bench ----
export const BENCH = { L: 1400, H: 420, Dmm: 450, D: depth(450) };
export function bench(): Art {
  const { L, H: h } = BENCH;
  const [dx, dy] = BENCH.D;
  return {
    vb: [-10, -h + dy - 10, L + dx + 20, h - dy + 10],
    body: `<rect x="0" y="${-h}" width="${L}" height="${h}" fill="${tint(0.07)}"/><path d="M0 ${-h}L${L} ${-h}L${f(L + dx)} ${f(-h + dy)}L${f(dx)} ${f(-h + dy)}Z" fill="${tint(0.2)}"/><path d="M${L} 0L${L} ${-h}L${f(L + dx)} ${f(-h + dy)}L${f(L + dx)} 0Z" fill="${tint(0.13)}"/>`,
  };
}

// ---- the towel, after the 2014 one: drawn flat once and carried back across the seat by the camera's depth mapping,
// so its skyline runs unbroken over the fold ----
export const TOWEL = { W: 300, seat: 405, hang: 145, end: 34, sag: 2 };
const TW = (() => {
  const c = TOWEL.W / 2;
  const band = TOWEL.W * 0.12;
  const ground = TOWEL.W * 0.06;
  const edge = 13;
  return { c, band, ground, edge, reach: c - band - ground - edge - 7 };
})();
function skyline(seed: number, side: number, base: number, reach: number, vA: number, vB: number): string {
  const random = rng(seed);
  const X = (h: number) => base + side * h;
  const pts: P[] = [[X(-2), vA]];
  let v = vA;
  let towers = 0;
  while (v < vB) {
    const w = Math.min(9 + random() * 11, vB - v);
    if (towers < 4 && random() < 0.12) {
      towers++;
      const h = reach * 0.8;
      if (random() < 0.5)
        pts.push([X(h), v], [X(h), v + w * 0.22], [X(reach * 0.95), v + w * 0.22], [X(reach * 0.95), v + w * 0.78], [X(h), v + w * 0.78], [X(h), v + w]);
      else pts.push([X(h), v], [X(h), v + w * 0.45], [X(reach), v + w * 0.45], [X(reach), v + w * 0.55], [X(h), v + w * 0.55], [X(h), v + w]);
    } else {
      const h = reach * (0.15 + random() * 0.6);
      pts.push([X(h), v], [X(h), v + w]);
    }
    v += w;
  }
  pts.push([X(-2), vB]);
  return poly(pts);
}
function towelPrint(): string {
  const { W: Wt, seat, hang, end, sag } = TOWEL;
  const { c, band, ground, reach } = TW;
  const v0 = -seat - 2;
  const v1 = hang + 2 * sag + 2;
  const rect = (x0: number, x1: number, fill: string, a = v0, z = v1) =>
    `<rect x="${f(x0)}" y="${f(a)}" width="${f(x1 - x0)}" height="${f(z - a)}" fill="${fill}"/>`;
  let p = rect(-2, Wt + 2, C.white) + rect(3.5, Wt - 3.5, C.navy) + rect(9.5, Wt - 9.5, C.white) + rect(13, Wt - 13, C.court);
  const g0 = c - band - ground;
  const g1 = c + band + ground;
  p += rect(g0, g1, C.navy);
  const vA = -seat + end - 2;
  const vB = hang + sag;
  p += `<path d="${skyline(2014, -1, g0, reach, vA, vB)}" fill="${C.navy}"/><path d="${skyline(2015, 1, g1, reach, vA, vB)}" fill="${C.navy}"/>`;
  p += rect(c - band, c + band, mix(C.white, C.quiet, 0.1));
  p += rect(-2, Wt + 2, C.ball, v0, -seat + end);
  p += `<path d="M-2 ${f(hang - end)}Q${c} ${f(hang - end + 2 * sag)} ${Wt + 2} ${f(hang - end)}L${Wt + 2} ${f(v1)}L-2 ${f(v1)}Z" fill="${C.ball}"/>`;
  p += `<path d="M16 ${f(hang - end / 2)}Q${c} ${f(hang - end / 2 + 2 * sag)} ${Wt - 16} ${f(hang - end / 2)}M16 ${f(-seat + end / 2)}H${Wt - 16}" fill="none" stroke="${C.navy}" stroke-opacity="0.6" stroke-width="3" stroke-linecap="round"/>`;
  return p;
}
export function towel(): Art {
  const { W: Wt, seat, hang, sag } = TOWEL;
  const [sx, sy] = depth(seat);
  const kS = id("tws");
  const kH = id("twh");
  const print = towelPrint();
  const seatClip = `M0 ${-seat}H${Wt}V0H0Z`;
  const hangClip = `M0 0H${Wt}V${hang}Q${Wt / 2} ${hang + 2 * sag} 0 ${hang}Z`;
  const onSeat = `matrix(1 0 ${f4(-DEPTH_DIR[0] * DEPTH_SCALE)} ${f4(-DEPTH_DIR[1] * DEPTH_SCALE)} 0 0)`;
  return {
    vb: [-12, sy - 10, Wt + sx + 24, hang + 2 * sag + 20 - sy],
    body:
      `<path d="M0 ${hang}Q${Wt / 2} ${hang + 2 * sag} ${Wt} ${hang}" fill="none" stroke="${SHADOW}" stroke-opacity="0.55" stroke-width="3.5" transform="translate(-1 1.8)"/>` +
      `<g transform="${onSeat}"><clipPath id="${kS}"><path d="${seatClip}"/></clipPath><g clip-path="url(#${kS})">${print}</g></g>` +
      `<clipPath id="${kH}"><path d="${hangClip}"/></clipPath><g clip-path="url(#${kH})">${print}<path d="${hangClip}" fill="${C.navy}" fill-opacity="0.15"/></g>` +
      `<rect x="0" y="-1.4" width="${Wt}" height="2.8" fill="${C.white}" fill-opacity="0.22"/>`,
  };
}

// ---- the racquet, after the Blade: drawn head down, the bottom of the head at (0, 0), the grip up ----
const FRAME = deep(0.62);
const GRIP = deep(0.42);
const COLLAR = mix(C.white, C.quiet, 0.35);
export const RQ = { cx: 0, cy: -167, rx: 127, ry: 167 };
export function armCurve(side: number): [P, P, P, P] {
  const a = ((side < 0 ? -128 : -52) * Math.PI) / 180;
  const p0: P = [RQ.cx + RQ.rx * Math.cos(a), RQ.cy + RQ.ry * Math.sin(a)];
  return [p0, [p0[0] - side * 34, p0[1] - 44], [side * 7, -450], [side * 7, -490]];
}
const WRAP = mix(GRIP, C.white, 0.06);
function gripWrap(): string {
  const kw = id("gw");
  let d = "";
  for (let y = -500; y >= -690; y -= 11) d += `M-16 ${y}L16 ${y - 13}`;
  return `<clipPath id="${kw}"><rect x="-15" y="-678" width="30" height="170"/></clipPath><path d="${d}" stroke="${WRAP}" stroke-width="1.2" clip-path="url(#${kw})"/>`;
}
export function racquet(): Art {
  const k = id("rq");
  const { cx, cy, rx, ry } = RQ;
  let strings = "";
  for (let x = -105; x <= 105; x += 21) strings += `M${x} -340V10`;
  for (let y = -320; y <= -14; y += 21) strings += `M-130 ${y}H130`;
  const pt = (deg: number): P => [cx + rx * Math.cos((deg * Math.PI) / 180), cy + ry * Math.sin((deg * Math.PI) / 180)];
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    return `M${f(x0)} ${f(y0)}A${rx} ${ry} 0 0 1 ${f(x1)} ${f(y1)}`;
  };
  const arm = (side: number) => {
    const [p0, p1, p2, p3] = armCurve(side);
    return `M${f(p0[0])} ${f(p0[1])}C${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])} ${f(p3[0])} ${f(p3[1])}`;
  };
  return {
    vb: [-140, -706, 280, 724],
    body:
      `<defs><clipPath id="${k}"><ellipse cx="${cx}" cy="${cy}" rx="${rx - 10}" ry="${ry - 10}"/></clipPath></defs><path d="${strings}" stroke="${C.white}" stroke-opacity="0.45" stroke-width="2" clip-path="url(#${k})"/>` +
      `<path d="${arm(-1)}${arm(1)}" fill="none" stroke="${FRAME}" stroke-width="15" stroke-linecap="round"/>` +
      `<rect x="-14.5" y="-512" width="29" height="46" rx="5" fill="${FRAME}"/>` +
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${FRAME}" stroke-width="16"/>` +
      `<path d="${arc(-35, 35)}${arc(145, 215)}" fill="none" stroke="${C.ball}" stroke-width="16"/>` +
      `<path d="M-15 -508H15L15 -678Q15 -686 18 -690V-700H-18V-690Q-15 -686 -15 -678Z" fill="${GRIP}"/>` +
      gripWrap() +
      `<rect x="-15" y="-511.5" width="30" height="4.5" rx="1.2" fill="${COLLAR}"/>`,
  };
}
/** It stands on its head on the floor this far in front of the bench and leans straight back against the bench's front
 * edge; on screen the camera tips its grip a few degrees right. */
export const HEAD_OUT = 120;
export const RACQUET_TILT = (Math.atan2(-depth(-HEAD_OUT)[0], BENCH.H + depth(-HEAD_OUT)[1]) * 180) / Math.PI;
/** Where a throat arm crosses racquet height y (mm, head down at 0): its centre's x. */
export function armX(side: number, y: number): number {
  const [p0, p1, p2, p3] = armCurve(side);
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2;
    if (cubicAt(p0, p1, p2, p3, t)[1] > y) lo = t;
    else hi = t;
  }
  return cubicAt(p0, p1, p2, p3, (lo + hi) / 2)[0];
}
