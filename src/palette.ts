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
  };
}

export type Palette = ReturnType<typeof readPalette>;
