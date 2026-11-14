import { describe, expect, it } from "vitest";
import { build } from "vite";

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
});
