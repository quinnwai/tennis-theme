import { describe, expect, it } from "vitest";
import { build } from "vite";
import { params } from "./params";
import { SOUNDS } from "./sound";

/** Every file `vite build` would write, without writing any. */
async function builtFiles() {
  const result = (await build({ logLevel: "silent", build: { write: false } })) as unknown;
  const { output } = (Array.isArray(result) ? result[0] : result) as {
    output: { fileName: string; source?: string | Uint8Array }[];
  };
  return output;
}

const textOf = (file: { source?: string | Uint8Array }) => String(file.source);

describe("the built site", () => {
  it("is one page, the homepage; the credits are an overlay on it, not a page of their own", async () => {
    const pages = (await builtFiles()).map((file) => file.fileName).filter((name) => name.endsWith(".html"));
    expect(pages).toEqual(["index.html"]);
    expect(Object.keys(import.meta.glob("../credits/**"))).toEqual([]);
  });

  it("reaches its own files by relative addresses only, so it works from a sub-path such as /tennis/", async () => {
    const files = await builtFiles();
    const html = textOf(files.find((file) => file.fileName === "index.html")!);
    const css = textOf(files.find((file) => file.fileName.endsWith(".css"))!);

    // Links out of the site (https:, mailto:) are fine; everything else has to start with ./ or ../.
    const addresses = [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((match) => match[1]);
    const own = addresses.filter((address) => !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(address));
    expect(own.length).toBeGreaterThan(1); // at least the script and the stylesheet
    for (const address of own) expect(address).toMatch(/^\.\.?\//);

    for (const [, address] of css.matchAll(/url\(\s*["']?([^"')]+)/g)) expect(address).toMatch(/^\.\.?\//);
  });

  it("ships every sound file, in the skin's own folder, and reaches each by a relative address", () => {
    // Whatever is in public/ is copied into the build as it is, so each file has to be there at its address.
    const inPublic = Object.keys(import.meta.glob("../public/tennis/**"));
    for (const { file } of Object.values(SOUNDS)) {
      expect(file).toMatch(/^\.\/tennis\//); // relative, and under tennis/ with the rest of what the build ships
      expect(inPublic, file).toContain(`../public/${file.slice(2)}`);
    }
  });

  it("starts the buttons at the size and tone in params.ts, so they do not jump when the script writes its own", async () => {
    const css = textOf((await builtFiles()).find((file) => file.fileName.endsWith(".css"))!);
    // What the stylesheet starts a custom property at. (The minified file may write 0.25 as .25, which is the same number.)
    const startsAt = (name: string) => new RegExp(`${name}:\\s*([^;}]+)`).exec(css)?.[1].trim();
    // The size is params.iconSize, or less on a short window: the share iconShare of its shorter side (dvmin is 1% of that).
    const share = Number((params.iconShare * 100).toFixed(4));
    expect(startsAt("--icon-size")?.replace(/\s+/g, "")).toBe(`min(${params.iconSize}px,${share}dvmin)`);
    expect(Number(startsAt("--icon-tone"))).toBe(params.iconTone);
  });
});
