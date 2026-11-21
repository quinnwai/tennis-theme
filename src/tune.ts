import { params, type Params } from "./params";

type Field = [key: keyof Params, label: string, min: number, max: number, step: number];

export const FIELDS: Field[] = [
  ["hitSpeed", "tap power (m/s)", 1, 10, 0.1],
  ["hitCarryOver", "old speed kept on a tap", 0, 1, 0.05],
  ["hitReach", "tap reach (ball radii)", 1, 5, 0.1],
  ["grabReach", "grab reach (ball radii)", 0.8, 3, 0.1],
  ["touchMinHitReachPx", "finger tap reach (px)", 16, 80, 1],
  ["touchMinGrabReachPx", "finger grab reach (px)", 8, 60, 1],
  ["floorLiftPx", "floor lift on a touch screen (px)", 0, 80, 1],
  ["tapMaxMs", "longest tap (ms)", 80, 500, 10],
  ["carrySpeed", "carry and throw speed (m/s)", 1, 20, 0.5],
  ["followRate", "carry tightness", 3, 60, 1],
  ["ballScale", "ball size vs the dot", 0.8, 1.8, 0.05],
  ["restitution", "bounciness", 0.3, 0.95, 0.005],
  ["gravity", "gravity (m/s²)", 2, 20, 0.1],
  ["drag", "air drag", 0, 0.1, 0.001],
  ["friction", "surface grip", 0, 1.5, 0.05],
  ["rollingResistance", "rolling resistance", 0, 0.5, 0.01],
  ["creditsBlur", "credits blur (px)", 0, 40, 1],
  ["creditsDim", "credits dimming (0 to 1)", 0, 1, 0.05],
  ["trailWidth", "trail width (× ball)", 0.2, 1.5, 0.05],
  ["trailPiece", "trail chip size (× ball)", 0.15, 1, 0.05],
  ["trailShrink", "trail shrink speed", 0.3, 5, 0.1],
  ["trailScatter", "trail scatter (× ball)", 0, 3, 0.05],
  ["trailLifetime", "trail lifetime (s)", 0.1, 2, 0.05],
  ["trailOpacity", "trail and poof opacity", 0.2, 1, 0.05],
  ["poofSize", "poof size (× ball)", 0.4, 2.5, 0.05],
  ["poofLifetime", "poof lifetime (s)", 0.1, 1, 0.05],
  ["soundHit", "sound: hit volume", 0, 1, 0.05],
  ["soundBounce", "sound: bounce volume", 0, 1, 0.05],
  ["soundRising", "sound: rising volume", 0, 1, 0.05],
  ["soundOut", "sound: ball out volume", 0, 1, 0.05],
  ["soundBounceMinSpeed", "sound: min bounce (m/s)", 0, 2, 0.05],
  ["soundBounceFullSpeed", "sound: loud bounce (m/s)", 1, 10, 0.5],
  ["soundMaxVoices", "sound: most at once", 1, 24, 1],
  ["soundSoftGain", "sound: soft level (× medium)", 0.1, 1, 0.05],
  ["soundLoudGain", "sound: loud level (× medium)", 1, 3, 0.05],
  ["soundShelfDb", "sound: highs cut (dB)", -12, 0, 0.5],
  ["soundShelfHz", "sound: highs start at (Hz)", 1500, 8000, 100],
  ["soundLowpassHz", "sound: top cut-off (Hz)", 4000, 22000, 250],
  ["iconTone", "button tone (0 to 1)", 0, 1, 0.05],
  ["iconSize", "button icon size (px, at most)", 12, 72, 1],
  ["iconShare", "icon share of the short side", 0.04, 0.2, 0.005],
];

/**
 * A small panel of sliders for tuning feel by hand. Shown only when the address has ?tune.
 * `rebuild` is called after every change, with the name of the number that moved, so the world can pick it up.
 */
export function mountTuner(rebuild: (changed: keyof Params) => void): void {
  const panel = document.createElement("div");
  // The panel is longer than a phone held sideways is tall, and the page itself never scrolls, so the panel scrolls on its
  // own (pan-y lets a finger do that), and a push past its end goes no farther.
  panel.style.cssText =
    "position:fixed;top:70px;left:12px;box-sizing:border-box;max-height:calc(100% - 82px);max-width:calc(100% - 24px);" +
    "overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;" +
    "padding:10px 12px;background:rgba(255,255,255,.92);" +
    "border-radius:8px;font:12px/1.5 ui-monospace,Menlo,monospace;color:#132637;z-index:10;";

  for (const [key, label, min, max, step] of FIELDS) {
    const row = document.createElement("label");
    row.style.cssText = "display:grid;grid-template-columns:190px 130px 48px;gap:8px;align-items:center;";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(params[key]);
    const value = document.createElement("span");
    value.textContent = String(params[key]);
    input.addEventListener("input", () => {
      params[key] = Number(input.value);
      value.textContent = input.value;
      rebuild(key);
    });
    row.append(label, input, value);
    panel.append(row);
  }

  const copy = document.createElement("button");
  copy.textContent = "copy values";
  copy.style.cssText = "margin-top:8px;font:inherit;";
  copy.addEventListener("click", () => {
    const values = Object.fromEntries(FIELDS.map(([key]) => [key, params[key]]));
    void navigator.clipboard.writeText(JSON.stringify(values, null, 2));
    copy.textContent = "copied";
    setTimeout(() => (copy.textContent = "copy values"), 1200);
  });
  panel.append(copy);

  document.body.append(panel);
}
