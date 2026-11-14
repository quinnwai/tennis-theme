// The page's icon: linked from the homepage by a relative address, served as a real image, and a small
// flat tennis ball in the site's own colors, with a PNG for browsers that do not take the SVG. Run in a
// real browser against the dev server or, with BASE_URL set, against a deployed copy.

import { expect, test, type Page } from "@playwright/test";

/** One `<link rel="icon">` of the homepage. */
interface Icon {
  /** The address exactly as written in the page. */
  written: string;
  /** The same address resolved against the page, which is what the browser asks for. */
  url: string;
  type: string | null;
  sizes: string | null;
}

/** Every icon the page links, in page order. */
const linkedIcons = (page: Page): Promise<Icon[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map((link) => ({
      written: link.getAttribute("href") ?? "",
      url: link.href,
      type: link.getAttribute("type"),
      sizes: link.getAttribute("sizes"),
    })),
  );

/** The icon of one format, which the page has to link. */
async function iconOfType(page: Page, type: string): Promise<Icon> {
  const icon = (await linkedIcons(page)).find((candidate) => candidate.type === type);
  expect(icon, `the page links an icon of type ${type}`).toBeDefined();
  return icon!;
}

test("the page links an icon, by an address relative to the page", async ({ page }) => {
  await page.goto("./");
  const icons = await linkedIcons(page);
  expect(icons.length).toBeGreaterThan(0);
  const folder = new URL("./", page.url()).href;
  for (const icon of icons) {
    // "./name" works from any sub-path; "/name" would look for the file at the root of the domain.
    expect(icon.written).toMatch(/^\.\//);
    expect(icon.url.startsWith(folder), `${icon.url} lies inside ${folder}`).toBe(true);
  }
});

test("each linked icon is found with a 200 and comes back as the image the page says it is", async ({ page }) => {
  const log: { url: string; status: number }[] = [];
  page.on("response", (response) => log.push({ url: response.url(), status: response.status() }));
  await page.goto("./");
  const icons = await linkedIcons(page);
  expect(icons.length).toBeGreaterThan(0);

  // A headless browser never asks for the page's icon by itself, so ask for each one from inside the page.
  // Those requests land in the same network log as everything else the page loads.
  const contentTypes = await page.evaluate(
    (urls) => Promise.all(urls.map(async (url) => (await fetch(url)).headers.get("content-type"))),
    icons.map((icon) => icon.url),
  );

  icons.forEach((icon, i) => {
    const statuses = log.filter((request) => request.url === icon.url).map((request) => request.status);
    expect(new Set(statuses), `the network log for ${icon.url}`).toEqual(new Set([200]));
    // The dev server answers an address it does not know with the homepage and a 200, so a 200 alone proves
    // little. The page also has to say what kind of image each icon is, so a browser can skip one it cannot draw.
    expect(icon.type).toMatch(/^image\//);
    expect(contentTypes[i]).toContain(icon.type);
  });
});

test("the SVG icon is a ball in the colors the page itself uses, green with a white seam", async ({ page }) => {
  await page.goto("./");
  const svg = await iconOfType(page, "image/svg+xml");

  const found = await page.evaluate(async (url) => {
    // "#fff" and "#ffffff" are the same color; the page's own colors are written the long way.
    const normal = (color: string) =>
      /^#[0-9a-f]{3}$/i.test(color) ? "#" + [...color.slice(1)].map((digit) => digit + digit).join("") : color.toLowerCase();
    const doc = new DOMParser().parseFromString(await (await fetch(url)).text(), "image/svg+xml");
    const css = getComputedStyle(document.documentElement);
    const paint = [...doc.querySelectorAll("[fill], [stroke]")]
      .flatMap((element) => [element.getAttribute("fill"), element.getAttribute("stroke")])
      .filter((value): value is string => value !== null && value !== "none")
      .map(normal);
    return {
      wellFormed: doc.querySelector("parsererror") === null && doc.documentElement.localName === "svg",
      // Colors set through CSS would slip past the check below, so the icon may not use any.
      usesCss: doc.querySelector("style") !== null || doc.querySelector("[style]") !== null,
      paint: [...new Set(paint)],
      ball: normal(css.getPropertyValue("--ball").trim()),
      ballShade: normal(css.getPropertyValue("--ball-shade").trim()),
      white: normal(css.getPropertyValue("--white").trim()),
    };
  }, svg.url);

  expect(found.wellFormed).toBe(true);
  expect(found.usesCss).toBe(false);
  expect(found.paint).toContain(found.ball);
  expect(found.paint).toContain(found.white);
  for (const color of found.paint) expect([found.ball, found.ballShade, found.white]).toContain(color);
});

test("the PNG icon is a real square PNG of the size the page says, and shows the same ball as the SVG", async ({ page }) => {
  await page.goto("./");
  const png = await iconOfType(page, "image/png");
  const svg = await iconOfType(page, "image/svg+xml");

  const bytes = await (await page.request.get(png.url)).body();
  expect([...bytes.subarray(0, 8)], "the PNG signature").toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(width).toBe(height);
  expect(width).toBeGreaterThanOrEqual(32);
  expect(png.sizes).toBe(`${width}x${height}`);

  // Draw both icons at the PNG's size and count the pixels that visibly differ. Only the edge pixels of the
  // ball may differ, and only slightly; an SVG that was changed without making the PNG again fails here.
  const differing = await page.evaluate(
    async ({ svgUrl, pngUrl, size }) => {
      const pixels = async (url: string) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, size, size);
        return context.getImageData(0, 0, size, size).data;
      };
      const [a, b] = await Promise.all([pixels(svgUrl), pixels(pngUrl)]);
      let count = 0;
      for (let i = 0; i < a.length; i += 4) {
        const gap = Math.max(...[0, 1, 2, 3].map((channel) => Math.abs(a[i + channel] - b[i + channel])));
        if (gap > 48) count++;
      }
      return count / (a.length / 4);
    },
    { svgUrl: svg.url, pngUrl: png.url, size: width },
  );
  expect(differing).toBeLessThan(0.005);
});
