import { params, type Params } from "./params";

type Field = [key: keyof Params, label: string, min: number, max: number, step: number];

const FIELDS: Field[] = [
  ["hitSpeed", "tap power (m/s)", 1, 10, 0.1],
  ["hitCarryOver", "old speed kept on a tap", 0, 1, 0.05],
  ["hitReach", "tap reach (ball radii)", 1, 5, 0.1],
  ["grabReach", "grab reach (ball radii)", 0.8, 3, 0.1],
  ["tapMaxMs", "longest tap (ms)", 80, 500, 10],
  ["maxFling", "fastest throw (m/s)", 4, 30, 0.5],
  ["followRate", "carry tightness", 5, 60, 1],
  ["restitution", "bounciness", 0.3, 0.95, 0.005],
  ["gravity", "gravity (m/s²)", 2, 20, 0.1],
  ["drag", "air drag", 0, 0.1, 0.001],
  ["friction", "surface grip", 0, 1.5, 0.05],
  ["rollingResistance", "rolling resistance", 0, 0.5, 0.01],
];

/** A small panel of sliders for tuning feel by hand. Shown only when the address ends in ?tune. */
export function mountTuner(onChange: () => void): void {
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;top:12px;left:12px;padding:10px 12px;background:rgba(255,255,255,.92);" +
    "border-radius:8px;font:12px/1.5 ui-monospace,Menlo,monospace;color:#0e2240;z-index:10;";

  for (const [key, label, min, max, step] of FIELDS) {
    const row = document.createElement("label");
    row.style.cssText = "display:grid;grid-template-columns:170px 130px 48px;gap:8px;align-items:center;";
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
      onChange();
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
