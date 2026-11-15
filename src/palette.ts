/** The colors the canvas draws with, read from the stylesheet so the page and the toy share one definition. */
export function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string) => css.getPropertyValue(name).trim();
  return {
    navy: get("--navy"),
    ball: get("--ball"),
    ballShade: get("--ball-shade"),
    white: get("--white"),
    quiet: get("--quiet"),
    // The bench, the bag, the cans and the notebook.
    bench: get("--bench"),
    benchTop: get("--bench-top"),
    benchLeg: get("--bench-leg"),
    bag: get("--bag"),
    bagShade: get("--bag-shade"),
    zipOpen: get("--zip-open"),
    can: get("--can"),
    canRim: get("--can-rim"),
    cover: get("--cover"),
    coverTape: get("--cover-tape"),
  };
}

export type Palette = ReturnType<typeof readPalette>;
