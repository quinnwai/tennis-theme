// The checks that say the first draft is done, run in a real browser against the dev server or,
// with BASE_URL set, against a deployed copy.

import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { params } from "../src/params";

/** One ball as the page's test hook reports it. Screen units: px and px/s, y down. */
interface Ball {
  id: number;
  pinned: boolean;
  held: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface Point {
  x: number;
  y: number;
}

/** Call something on window.__sandbox, the page's test hook, and return what it gives back. */
const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const balls = (page: Page) => sandbox<Ball[]>(page, "balls()");
const ball = async (page: Page, id: number) => (await balls(page)).find((b) => b.id === id)!;
/** Run the simulation forward without waiting for frames. */
const advance = (page: Page, seconds: number) => sandbox<void>(page, `advance(${seconds})`);
/** The ball currently sitting as the dot of the first or second "i". */
const dot = (page: Page, index: number) =>
  page.evaluate((i) => {
    const s = (window as any).__sandbox;
    const home = s.layout().dots[i];
    return s.balls().find((b: Ball) => b.pinned && Math.hypot(b.x - home.x, b.y - home.y) < 2) as Ball;
  }, index);

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
});

test("a click under a ball sends it up", async ({ page }) => {
  const d = await dot(page, 0);
  await page.mouse.click(d.x, d.y + d.r * 0.8);
  const hit = await sandbox<{ id: number; dir: Point }>(page, "lastHit()");
  expect(hit.id).toBe(d.id);
  expect(hit.dir.y).toBeLessThan(-0.95);
  await advance(page, 1 / 240);
  const after = await ball(page, d.id);
  expect(after.pinned).toBe(false);
  expect(after.vy).toBeLessThan(0);
  expect(Math.abs(after.vx)).toBeLessThan(Math.abs(after.vy) * 0.2);
});

test("a click at a ball's bottom left sends it up and to the right, along the line through its center", async ({ page }) => {
  const d = await dot(page, 1);
  const click = { x: d.x - d.r * 0.6, y: d.y + d.r * 0.6 };
  await page.mouse.click(click.x, click.y);
  const hit = await sandbox<{ dir: Point }>(page, "lastHit()");
  const length = Math.hypot(d.x - click.x, d.y - click.y);
  const expected = { x: (d.x - click.x) / length, y: (d.y - click.y) / length };
  expect(hit.dir.x * expected.x + hit.dir.y * expected.y).toBeGreaterThan(0.99);
  await advance(page, 1 / 240);
  const after = await ball(page, d.id);
  expect(after.vx).toBeGreaterThan(0);
  expect(after.vy).toBeLessThan(0);
});

test("pressing and holding a ball lets you drag it around", async ({ page }) => {
  const d = await dot(page, 0);
  const target = { x: d.x + 150, y: d.y - 160 };
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(d.x + 60, d.y - 80, { steps: 10 });
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await expect
    .poll(async () => {
      const b = await ball(page, d.id);
      return Math.hypot(b.x - target.x, b.y - target.y);
    })
    .toBeLessThan(6);
  expect((await ball(page, d.id)).held).toBe(true);
  await page.mouse.up();
  expect((await ball(page, d.id)).held).toBe(false);
});

test("pressing, moving and letting go throws the ball the way it was moving", async ({ page }) => {
  const d = await dot(page, 0);
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  // The pointer goes a long way off, so the ball is still chasing it, at full carrying speed, for
  // a good third of a second, however long this machine takes to get to the next line.
  await page.mouse.move(d.x + 800, d.y - 160, { steps: 5 });
  await page.waitForTimeout(80); // the ball is still chasing the pointer when it is let go
  await page.mouse.up();
  const thrown = await ball(page, d.id);
  expect(thrown.held).toBe(false);
  expect(thrown.vx).toBeGreaterThan(300);
  expect(Math.abs(thrown.vy)).toBeLessThan(thrown.vx);
});

test("a hit shows a pow, and a ball in flight leaves a trail", async ({ page }) => {
  const d = await dot(page, 0);
  await page.mouse.click(d.x - d.r * 0.6, d.y + d.r * 0.6);
  await expect.poll(() => sandbox<number>(page, "effects().bursts"), { intervals: [10] }).toBeGreaterThan(0);
  await expect.poll(() => sandbox<number>(page, "effects().trailPoints")).toBeGreaterThan(3);
});

test("balls bounce off the floor and the side walls", async ({ page }) => {
  const d = await dot(page, 0);
  // Carry the left-hand dot up and across to the right wall, over the top of the other dot, and let
  // it go while it is still moving. It is a long way, so the ball is still chasing the pointer at
  // full carrying speed for a good third of a second, however long this machine takes to get to the
  // lines below.
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(1400, d.y - 150, { steps: 5 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  const seen = await page.evaluate((id) => {
    const s = (window as any).__sandbox;
    const find = () => s.balls().find((b: Ball) => b.id === id) as Ball | undefined;
    let prev = find()!;
    const seen = { lost: false, right: 0, bottom: 0, offWall: false, offFloor: false, width: innerWidth, height: innerHeight };
    for (let i = 0; i < 720; i++) {
      s.advance(1 / 120);
      const b = find();
      if (!b) {
        seen.lost = true;
        break;
      }
      seen.right = Math.max(seen.right, b.x + b.r);
      seen.bottom = Math.max(seen.bottom, b.y + b.r);
      if (prev.vx > 60 && b.vx < -60) seen.offWall = true;
      if (prev.vy > 60 && b.vy < -60) seen.offFloor = true;
      prev = b;
    }
    return seen;
  }, d.id);
  expect(seen.lost).toBe(false);
  expect(seen.offWall).toBe(true);
  expect(seen.offFloor).toBe(true);
  expect(seen.right).toBeLessThan(seen.width + 2);
  expect(seen.bottom).toBeLessThan(seen.height + 2);
});

test("balls bounce off the letters and each other", async ({ page }) => {
  // Letters: set a ball down above the first "n" and it comes to rest on the name, not inside it or under it.
  const first = await dot(page, 0);
  const above = await page.evaluate(() => {
    const letters = (window as any).__sandbox.layout().letters;
    const n = letters.find((l: { char: string }) => l.char === "n").loops.flat() as Point[];
    const xs = n.map((p) => p.x);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...n.map((p) => p.y)) - 90 };
  });
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(first.x, above.y, { steps: 8 });
  await page.mouse.move(above.x, above.y, { steps: 8 });
  await expect.poll(async () => Math.hypot((await ball(page, first.id)).x - above.x, (await ball(page, first.id)).y - above.y)).toBeLessThan(6);
  await page.waitForTimeout(120); // let it stop before letting go, so it drops straight down
  await page.mouse.up();
  await advance(page, 5);
  const rested = await page.evaluate((id) => {
    const s = (window as any).__sandbox;
    const b = s.balls().find((ball: Ball) => ball.id === id) as Ball;
    const layout = s.layout();
    const inside = (p: Point, loop: Point[]) => {
      let hit = false;
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i];
        const c = loop[j];
        if (a.y > p.y !== c.y > p.y && p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x) hit = !hit;
      }
      return hit;
    };
    const loops = layout.letters.flatMap((l: { loops: Point[][] }) => l.loops) as Point[][];
    return { speed: Math.hypot(b.vx, b.vy), y: b.y, baseline: layout.origin.y, insideALetter: loops.some((loop) => inside(b, loop)) };
  }, first.id);
  expect(rested.speed).toBeLessThan(1);
  expect(rested.insideALetter).toBe(false);
  expect(rested.y).toBeLessThan(rested.baseline);

  // Each other: carry that ball into the other dot, which comes loose.
  const second = await dot(page, 1);
  const carried = await ball(page, first.id);
  await page.mouse.move(carried.x, carried.y);
  await page.mouse.down();
  await page.mouse.move(carried.x, second.y - 120, { steps: 8 });
  await page.mouse.move(second.x - 120, second.y - 120, { steps: 8 });
  await page.mouse.move(second.x - 120, second.y, { steps: 8 });
  await page.mouse.move(second.x + 60, second.y, { steps: 8 });
  await expect.poll(async () => (await ball(page, second.id)).pinned).toBe(false);
  await page.mouse.up();
});

test("the name is clearly readable in a screenshot", async ({ page }, testInfo) => {
  await expect(page.locator("h1")).toHaveText("quinn wai");
  // Find one point inside the ink of every letter, then read what the canvas actually painted there.
  const read = () =>
    page.evaluate(() => {
      const s = (window as any).__sandbox;
      const canvas = document.getElementById("court") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      const dpr = canvas.width / canvas.clientWidth;
      const pixel = (p: Point) => [...ctx.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data.slice(0, 3)];
      const inside = (p: Point, loop: Point[]) => {
        let hit = false;
        for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
          const a = loop[i];
          const c = loop[j];
          if (a.y > p.y !== c.y > p.y && p.x < ((c.x - a.x) * (p.y - a.y)) / (c.y - a.y) + a.x) hit = !hit;
        }
        return hit;
      };
      const letters = s.layout().letters as { char: string; loops: Point[][] }[];
      const ink = letters.map((letter) => {
        const points = letter.loops.flat();
        const left = Math.min(...points.map((p) => p.x));
        const right = Math.max(...points.map((p) => p.x));
        const top = Math.min(...points.map((p) => p.y));
        const bottom = Math.max(...points.map((p) => p.y));
        for (let gy = 1; gy < 12; gy++) {
          for (let gx = 1; gx < 12; gx++) {
            const p = { x: left + ((right - left) * gx) / 12, y: top + ((bottom - top) * gy) / 12 };
            // Inside an odd number of loops means inside a stroke rather than inside a hole such as the bowl of the q.
            if (letter.loops.filter((loop) => inside(p, loop)).length % 2 === 1) return pixel(p);
          }
        }
        return null;
      });
      return { ink, background: pixel({ x: canvas.clientWidth / 2, y: 40 }) };
    });
  await expect.poll(async () => (await read()).ink.every((rgb) => rgb && rgb.every((v) => v > 250))).toBe(true);
  const { ink, background } = await read();
  expect(ink).toHaveLength(8);
  // Contrast between the letters and the background, by the usual accessibility formula. 7 is the strictest bar for text.
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  expect((luminance(ink[0]!) + 0.05) / (luminance(background) + 0.05)).toBeGreaterThan(7);
  await testInfo.attach("homepage", { body: await page.screenshot(), contentType: "image/png" });
});

test("the contact control opens, and its links go to the right places", async ({ page }) => {
  const contact = page.getByRole("navigation", { name: "Contact" });
  const email = contact.getByRole("link", { name: "Email" });
  const github = contact.getByRole("link", { name: "GitHub" });
  const linkedin = contact.getByRole("link", { name: "LinkedIn" });
  await expect(email).toBeHidden();
  await contact.getByRole("button", { name: "Contact" }).click();
  await expect(email).toBeVisible();
  await expect(email).toHaveAttribute("href", "mailto:quinnwai.wong@gmail.com");
  await expect(github).toHaveAttribute("href", "https://github.com/quinnwai");
  await expect(github).toHaveAttribute("target", "_blank");
  await expect(linkedin).toHaveAttribute("href", "https://www.linkedin.com/in/quinn-wai-wong/");
  await expect(linkedin).toHaveAttribute("target", "_blank");
});

// ---- The credits: text over the blurred toy, on the homepage itself ----

const creditsButton = (page: Page) => page.getByRole("button", { name: "Credits", exact: true });
const credits = (page: Page) => page.getByRole("dialog", { name: "Credits" });
const openCredits = async (page: Page) => {
  await creditsButton(page).click();
  await expect(credits(page)).toBeVisible();
};

/** A row of pixels straight across the stem of the name's last "i": two crisp white-on-navy edges while the toy is sharp. */
const stemRow = (page: Page) =>
  page.evaluate(() => {
    const letters = (window as any).__sandbox.layout().letters as { loops: { x: number; y: number }[][] }[];
    const stem = letters[letters.length - 1].loops[0];
    const xs = stem.map((p) => p.x);
    const ys = stem.map((p) => p.y);
    const left = Math.min(...xs);
    return {
      x: Math.floor(left - 20),
      y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
      width: Math.ceil(Math.max(...xs) - left + 40),
    };
  });

/** The pixels of one rectangle of a screenshot, as red, green, blue and alpha in turn. */
async function pixelsOf(page: Page, rect: { x: number; y: number; width: number; height: number }) {
  // The screenshot is of the whole page, since a clipped one would blur only what is inside the clip, and in
  // CSS pixels, so that the coordinates used here mean the same thing at any screen density.
  const png = await page.screenshot({ scale: "css" });
  const pixels = await page.evaluate(
    async ([base64, r]) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(r.x, r.y, r.width, r.height).data;
    },
    [png.toString("base64"), rect] as const,
  );
  return Array.from(pixels);
}

/**
 * What a row of pixels shows. `range` is the difference between its darkest and brightest pixel, so it says
 * whether there is still a picture in the row. `sharpness` is the biggest jump between two neighbouring
 * pixels as a share of that range: a crisp edge takes nearly all of the range in a pixel or two, a blurred
 * edge spreads it over many pixels, so each step is small.
 */
async function rowStats(page: Page, row: { x: number; y: number; width: number }) {
  const pixels = await pixelsOf(page, { ...row, height: 1 });
  const green = Array.from({ length: row.width }, (_, i) => pixels[i * 4 + 1]);
  const range = Math.max(...green) - Math.min(...green);
  const step = Math.max(...green.slice(1).map((v, i) => Math.abs(v - green[i])));
  return { range, sharpness: range === 0 ? 0 : step / range };
}

test("the credits button shows the credit text over the toy, blurred behind it, without leaving the page", async ({ page }) => {
  const address = page.url();
  const row = await stemRow(page);
  await expect(credits(page)).toBeHidden();
  expect((await rowStats(page, row)).sharpness).toBeGreaterThan(0.5); // the toy is sharp before, so the row really crosses an edge

  await openCredits(page);
  await expect(credits(page)).toContainText("Monument Valley");
  expect(page.url()).toBe(address);

  // The toy is still there behind the text, and blurred: the CSS says so, and so do the pixels.
  await expect(page.locator("#court")).toBeVisible();
  expect(await balls(page)).toHaveLength(2);
  const filter = await credits(page).evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(Number(/^blur\(([\d.]+)px\)$/.exec(filter)?.[1])).toBeGreaterThan(0);
  const text = (await credits(page).locator(".credits-text").boundingBox())!;
  expect(text.x + text.width).toBeLessThan(row.x); // the row is measured clear of the text itself
  await expect.poll(async () => (await rowStats(page, row)).sharpness).toBeLessThan(0.2);
  expect((await rowStats(page, row)).range).toBeGreaterThan(8); // blurred, not hidden: the edge is still there, just soft
});

test("the credit text stays readable over the brightest part of the blurred name", async ({ page }) => {
  await openCredits(page);
  const text = credits(page).locator(".credits-text");
  const box = (await text.boundingBox())!;
  // The check below looks at what is behind the text, so some of the name has to be there.
  const nameBehindText = await page.evaluate((b) => {
    const letters = (window as any).__sandbox.layout().letters as { loops: { x: number; y: number }[][] }[];
    return letters.some((letter) => {
      const points = letter.loops.flat();
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      return Math.min(...xs) < b.x + b.width && Math.max(...xs) > b.x && Math.min(...ys) < b.y + b.height && Math.max(...ys) > b.y;
    });
  }, box);
  expect(nameBehindText).toBe(true);
  await text.evaluate((el) => (el.style.visibility = "hidden")); // look at what is behind the text, not at the text
  const pixels = await pixelsOf(page, { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) });
  // Luminance by the usual accessibility formula; the brightest pixel behind the text is the hardest one to read white on.
  const linear = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  let brightest = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    brightest = Math.max(brightest, 0.2126 * linear(pixels[i]) + 0.7152 * linear(pixels[i + 1]) + 0.0722 * linear(pixels[i + 2]));
  }
  // White has a luminance of 1. 4.5 is the usual bar for body text.
  expect(1.05 / (brightest + 0.05)).toBeGreaterThan(4.5);
});

test("Escape closes the credits", async ({ page }) => {
  await openCredits(page);
  await page.keyboard.press("Escape");
  await expect(credits(page)).toBeHidden();
  await expect(page.locator("#court")).toBeVisible();
});

test("on a window too small for the credit text, its first line is still on screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 200 }); // about what 400% zoom leaves of a laptop screen
  await openCredits(page);
  const first = (await credits(page).locator("p").boundingBox())!;
  expect(first.y).toBeGreaterThanOrEqual(0);
});

test("a click outside the credit text closes the credits, and does not hit the ball under it", async ({ page }) => {
  await openCredits(page);
  const text = (await credits(page).locator(".credits-text").boundingBox())!;
  const second = await dot(page, 1);
  expect(text.x + text.width).toBeLessThan(second.x - second.r); // this dot is clear of the text

  // A click on the text itself leaves the credits open...
  await credits(page).getByText("color palette").click();
  await expect(credits(page)).toBeVisible();
  // ...and so does a press on the text that lets go beside it, as when selecting a name to copy...
  const line = (await credits(page).getByText("typeface").boundingBox())!;
  await page.mouse.move(line.x + 10, line.y + line.height / 2);
  await page.mouse.down();
  await page.mouse.move(text.x + text.width + 60, line.y + line.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(credits(page)).toBeVisible();
  // ...but a click beside it, right on a ball, closes them and goes no further: the ball is not hit.
  await page.mouse.click(second.x, second.y);
  await expect(credits(page)).toBeHidden();
  expect(await sandbox(page, "lastHit()")).toBeNull();
  expect((await ball(page, second.id)).pinned).toBe(true);
});

test("the close button closes the credits, from the keyboard or with the mouse", async ({ page }) => {
  const close = credits(page).getByRole("button", { name: "Close" });
  // It has the focus the moment the credits open, so Enter presses it.
  await openCredits(page);
  await expect(close).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(credits(page)).toBeHidden();

  await openCredits(page);
  await close.click();
  await expect(credits(page)).toBeHidden();
  await expect(page.locator("#court")).toBeVisible();
});

test('the credit text starts with "inspo…" and has no title of its own', async ({ page }) => {
  await openCredits(page);
  await expect(credits(page).getByRole("heading")).toHaveCount(0);
  await expect(credits(page).locator(".credits-text > *").first()).toHaveText("inspo…");
});

test("the credit text says word for word what CITATIONS.md says", async ({ page }) => {
  const markdown = readFileSync(new URL("../CITATIONS.md", import.meta.url), "utf8");
  const lines = markdown.split("\n");
  const intro = lines.find((line) => line.trim() !== "" && !/^(-|\s|<!--)/.test(line)); // the first line that is not a bullet or a note
  const link = /\[([^\]]+)\]\(([^)]+)\)/g;
  const plain = (text: string) => text.replace(link, "$1");
  // The list: a bullet at the margin is an item, and bullets indented under it are the lines inside that item.
  const items: { text: string; inside: string[] }[] = [];
  const bullets: string[] = [];
  for (const line of lines) {
    const bullet = /^(\s*)- (.*)$/.exec(line);
    if (!bullet) continue;
    bullets.push(bullet[2]);
    if (bullet[1] === "") items.push({ text: plain(bullet[2]), inside: [] });
    else items[items.length - 1].inside.push(plain(bullet[2]));
  }
  const links = bullets.flatMap((bullet) => [...bullet.matchAll(link)].map(([, text, href]) => ({ text, href })));
  expect(intro).toBeTruthy();
  expect(items.length).toBeGreaterThan(0);
  expect(items.some((item) => item.inside.length > 0)).toBe(true); // the sounds, with a line for each

  await openCredits(page);
  await expect(credits(page).locator("p")).toHaveText(intro!);
  // What each item says, and the lines inside it, as the page shows them. Not just the text of the whole item,
  // which would include everything inside it.
  const shown = await credits(page)
    .locator(".credits-text > ul")
    .evaluate((list) => {
      const own = (li: Element) => {
        const copy = li.cloneNode(true) as Element;
        copy.querySelectorAll("ul").forEach((inner) => inner.remove());
        return copy.textContent!.replace(/\s+/g, " ").trim();
      };
      return [...list.children].map((li) => ({ text: own(li), inside: [...li.querySelectorAll(":scope > ul > li")].map(own) }));
    });
  expect(shown).toEqual(items);
  await expect(credits(page).getByRole("link")).toHaveCount(links.length);
  for (const { text, href } of links) {
    await expect(credits(page).getByRole("link", { name: text, exact: true })).toHaveAttribute("href", href);
  }
});

test("with ?tune, the blur and the dimming have sliders that work while the credits are open", async ({ page }) => {
  await page.goto("./?tune");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  await openCredits(page);

  const alpha = () =>
    credits(page).evaluate((el) => {
      // Written as color(srgb r g b / a) or rgba(r, g, b, a), with no alpha shown at all when it is 1.
      const match = /(?:\/ |, )([\d.]+)\)$/.exec(getComputedStyle(el).backgroundColor);
      return match ? Number(match[1]) : 1;
    });
  const blur = page.getByLabel("credits blur");
  const dim = page.getByLabel("credits dim");

  // A real click on the slider: it only lands if nothing, such as the credits themselves, covers it. It goes
  // to whichever end is farther from where the slider is now, so it moves the slider whatever the default is.
  const before = await credits(page).evaluate((el) => getComputedStyle(el).backdropFilter);
  const track = (await blur.boundingBox())!;
  const inLowerHalf = Number(await blur.inputValue()) <= Number(await blur.getAttribute("max")) / 2;
  await blur.click({ position: { x: inLowerHalf ? track.width - 4 : 4, y: track.height / 2 } });
  const after = await credits(page).evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(after).toBe(`blur(${await blur.inputValue()}px)`);
  expect(after).not.toBe(before);

  await dim.fill("0.25");
  await expect.poll(alpha).toBeCloseTo(0.25, 2);
  await dim.fill("0.9");
  await expect.poll(alpha).toBeCloseTo(0.9, 2);

  // Tuning the credits' look must leave the toy behind them alone. Rebuilding the court would stop every ball in
  // the air dead, and a rebuild makes the name's layout afresh, so a new layout is how to tell. (Checked in one
  // step, so that no ball can move in between.)
  const untouched = await page.evaluate(() => {
    const sandbox = (window as any).__sandbox;
    const slider = [...document.querySelectorAll<HTMLInputElement>("input[type=range]")].find((input) =>
      input.parentElement!.textContent!.includes("credits blur"),
    )!;
    const layout = sandbox.layout();
    const balls = JSON.stringify(sandbox.balls());
    slider.value = String(Number(slider.value) === 25 ? 24 : 25);
    slider.dispatchEvent(new Event("input"));
    return { sameLayout: sandbox.layout() === layout, sameBalls: JSON.stringify(sandbox.balls()) === balls };
  });
  expect(untouched).toEqual({ sameLayout: true, sameBalls: true });
});

// ---- The corner buttons: credits, clear and sound in a row at the top right, the "?" at the bottom right, all bare icons ----

const soundToggle = (page: Page) => page.getByRole("switch", { name: "Sound" });
const clearButton = (page: Page) => page.getByRole("button", { name: "Clear the balls" });
const contactButton = (page: Page) => page.getByRole("navigation", { name: "Contact" }).getByRole("button", { name: "Contact" });
/** The four buttons that are always on the page. The info button is the credits one; the restart button is the clear one. */
const cornerButtons = (page: Page) => [creditsButton(page), clearButton(page), soundToggle(page), contactButton(page)];

/** Everything the page has in browser storage, as an object. */
const stored = (page: Page) =>
  page.evaluate(() => {
    const all: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      all[key] = localStorage.getItem(key)!;
    }
    return all;
  });

/** Load the page again and wait for the toy to be up, as `beforeEach` does the first time. */
async function reload(page: Page) {
  await page.reload();
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
}

/** Red, green and blue (0 to 255) of any CSS color, however the browser writes it. */
const rgbOf = (page: Page, css: string) =>
  page.evaluate((color) => {
    const ctx = new OffscreenCanvas(1, 1).getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, css);

/** The color a control's icon is drawn in, which is its text color. */
const iconColor = async (page: Page, control: Locator) => rgbOf(page, await control.evaluate((el) => getComputedStyle(el).color));

/** Wait until every fade on the page has finished. The buttons change color over 0.15 s, so a color read sooner may be halfway. */
const fadesDone = (page: Page) =>
  page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)).then(() => undefined));

/** How light a color is, by the usual accessibility formula: 0 is black and 1 is white. */
const lightness = (rgb: number[]) => {
  const [r, g, b] = rgb.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * How many pixels of two same-size PNG pictures differ by more than a shade in some color. Two pictures of the same
 * thing can still differ by a level in a pixel here and there, from the way edges are smoothed, so equal bytes are too much to ask.
 */
const differingPixels = (page: Page, a: Buffer, b: Buffer) =>
  page.evaluate(
    async ([first, second]) => {
      const read = async (base64: string) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [x, y] = await Promise.all([read(first), read(second)]);
      let count = 0;
      for (let i = 0; i < x.length; i += 4) {
        if (Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2])) > 32) count++;
      }
      return count;
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );

/**
 * Sixteen pixels spaced round the middle of the outer 1.5px of a button's box, which is where a 1.5px circle would be
 * drawn if it had one. (An icon never reaches that far out: the restart arrow's corner comes within a pixel of it.)
 */
async function ringPixels(page: Page, control: Locator) {
  const box = (await control.boundingBox())!;
  const size = Math.ceil(box.width);
  const pixels = await pixelsOf(page, { x: Math.floor(box.x), y: Math.floor(box.y), width: size, height: size });
  const radius = box.width / 2 - 0.75;
  return Array.from({ length: 16 }, (_, i) => {
    const angle = (i * Math.PI) / 8;
    const x = Math.round(size / 2 + radius * Math.cos(angle) - 0.5);
    const y = Math.round(size / 2 + radius * Math.sin(angle) - 0.5);
    return [0, 1, 2].map((channel) => pixels[(y * size + x) * 4 + channel]);
  });
}

/** What a ball did on its way to a button. */
interface Flight {
  /** Where the ball was, and how fast it was moving at the button, when it was let go. */
  thrown: { from: number; speed: number };
  /** The nearest the ball's middle came to the button's middle, in px. */
  closest: number;
  /** Whether it reached the button and then left it fast. */
  bounced: boolean;
  /** How far apart the two middles are when the ball touches the button. */
  contact: number;
}

/**
 * Throw a ball at a button and see what the button does to it. The real mouse picks up the right-hand dot and carries
 * it to a spot straight below the button (sideways first, clear of the letters), where it settles. Then, in one in-page
 * step so that no frame can slip in between and move the ball unseen, the pointer is put on the button's middle so that
 * the ball runs straight up at it, and the ball is let go a short run-up away, while it is moving fast, and watched
 * for a second.
 */
async function throwAt(page: Page, button: Locator): Promise<Flight> {
  const box = (await button.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const below = { x: at.x, y: at.y + 260 };
  const d = await dot(page, 1);
  const contact = box.width / 2 + d.r;
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(below.x, d.y, { steps: 8 });
  await page.mouse.move(below.x, below.y, { steps: 8 });
  await expect.poll(async () => Math.hypot((await ball(page, d.id)).x - below.x, (await ball(page, d.id)).y - below.y)).toBeLessThan(6);
  await page.waitForTimeout(120); // let it stop, so that the run-up starts the same way every time

  const flight = await page.evaluate(
    ({ id, at, contact }) => {
      const sandbox = (window as any).__sandbox;
      const find = () => sandbox.balls().find((b: Ball) => b.id === id) as Ball;
      const gap = (b: Ball) => Math.hypot(b.x - at.x, b.y - at.y);
      // How fast the ball is moving toward the button's middle, in px/s. Negative means it is moving away.
      const toward = (b: Ball) => -((b.x - at.x) * b.vx + (b.y - at.y) * b.vy) / gap(b);

      // The pointer goes to the button's middle, so the carried ball chases it in a straight line.
      document.getElementById("court")!.dispatchEvent(new PointerEvent("pointermove", { clientX: at.x, clientY: at.y }));
      let ball = find();
      for (let i = 0; i < 2400 && gap(ball) > contact + 70; i++) {
        sandbox.advance(1 / 240);
        ball = find();
      }
      const thrown = { from: gap(ball), speed: toward(ball) };
      document.getElementById("court")!.dispatchEvent(new PointerEvent("pointerup"));

      let closest = Infinity;
      let bounced = false;
      for (let i = 0; i < 240; i++) {
        sandbox.advance(1 / 240);
        ball = find();
        closest = Math.min(closest, gap(ball));
        if (closest < contact + 10 && toward(ball) < -300) bounced = true; // it reached the button, and now it is leaving
      }
      return { thrown, closest, bounced };
    },
    { id: d.id, at, contact },
  );
  await page.mouse.up();
  return { ...flight, contact };
}

/** A real throw that reached the button, did not go into it, and came away from it. */
function expectBounce(flight: Flight) {
  expect(flight.thrown.speed).toBeGreaterThan(600); // a real throw: it was moving at the button when let go...
  expect(flight.thrown.from).toBeGreaterThan(flight.contact + 30); // ...from a run-up away, not already against it
  expect(flight.closest).toBeGreaterThan(flight.contact - 4); // it never got inside the button
  expect(flight.closest).toBeLessThan(flight.contact + 10); // though it did reach it
  expect(flight.bounced).toBe(true); // and it came away
}

test("the info, restart and sound buttons sit in a row in the top right corner, in that order, and the left corners are free", async ({ page }) => {
  const [info, restart, sound] = await Promise.all(
    [creditsButton(page), clearButton(page), soundToggle(page)].map(async (button) => (await button.boundingBox())!),
  );
  const { width, height } = page.viewportSize()!;
  // Left to right: info, restart, sound...
  expect(info.x + info.width).toBeLessThanOrEqual(restart.x);
  expect(restart.x + restart.width).toBeLessThanOrEqual(sound.x);
  // ...level with each other, the same size, and evenly spaced...
  for (const box of [restart, sound]) {
    expect(box.y).toBeCloseTo(info.y, 0);
    expect(box.width).toBeCloseTo(info.width, 0);
  }
  expect(restart.x - (info.x + info.width)).toBeCloseTo(sound.x - (restart.x + restart.width), 0);
  // ...with the sound button in the corner itself.
  expect(width - (sound.x + sound.width)).toBeLessThan(20);
  expect(sound.y).toBeLessThan(20);

  // The "?" is the one button at the bottom right, and nothing but the toy itself is in the two left corners.
  const contact = (await contactButton(page).boundingBox())!;
  expect(width - (contact.x + contact.width)).toBeLessThan(20);
  expect(height - (contact.y + contact.height)).toBeLessThan(20);
  expect(await page.evaluate(() => [document.elementFromPoint(38, 38)?.id, document.elementFromPoint(38, innerHeight - 38)?.id])).toEqual([
    "court",
    "court",
  ]);
});

test("the close button takes the info button's place while the credits are open", async ({ page }) => {
  const info = (await creditsButton(page).boundingBox())!;
  await openCredits(page);
  const close = (await credits(page).getByRole("button", { name: "Close" }).boundingBox())!;
  for (const key of ["x", "y", "width", "height"] as const) expect(close[key]).toBeCloseTo(info[key], 0);
});

test("the ? has a circle around it, in its own tone and as thick as the icons' lines, and no other button has one", async ({ page }) => {
  const navy = await rgbOf(page, await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--navy")));
  const isNavy = (rgb: number[]) => rgb.every((v, i) => Math.abs(v - navy[i]) <= 4);
  const bare = (control: Locator) =>
    control.evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopWidth, fill: s.backgroundColor };
    });

  // The credits, restart and sound buttons: no border and no fill, and the pixels agree: all the way round where a
  // circle would be, the page is just its navy.
  for (const button of [creditsButton(page), clearButton(page), soundToggle(page)]) {
    expect(await bare(button), (await button.getAttribute("aria-label")) ?? "").toEqual({ border: "0px", fill: "rgba(0, 0, 0, 0)" });
    expect((await ringPixels(page, button)).every(isNavy)).toBe(true);
  }

  // The "?" has its circle back: a solid border in the same color as its glyph (so the one tone sets both), no fill, as
  // thick as the lines of the icons (1.8 of their 24 units, give or take the whole pixel a browser rounds a border to),
  // and the pixels show it all the way round. That is also what shows the pixel check above can tell a circle from none.
  const ring = await contactButton(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.borderTopStyle, width: parseFloat(s.borderTopWidth), color: s.borderTopColor, glyph: s.color, fill: s.backgroundColor };
  });
  expect(ring.style).toBe("solid");
  expect(ring.color).toBe(ring.glyph);
  expect(ring.fill).toBe("rgba(0, 0, 0, 0)");
  expect(Math.abs(ring.width - (params.iconSize / 24) * 1.8)).toBeLessThan(1);
  expect((await ringPixels(page, contactButton(page))).some(isNavy)).toBe(false);

  // The links that open above the "?" have no circle.
  await contactButton(page).click();
  const links = await page.getByRole("navigation", { name: "Contact" }).getByRole("link").all();
  expect(links).toHaveLength(3);
  for (const link of links) expect(await bare(link)).toEqual({ border: "0px", fill: "rgba(0, 0, 0, 0)" });
});

test("every button is in one tone, the one in params.ts, and turns white under the pointer", async ({ page }) => {
  const navy = await rgbOf(page, await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--navy")));
  const expected = navy.map((v) => v + (255 - v) * params.iconTone); // the page's navy lightened toward white by the tone
  await fadesDone(page);
  for (const button of cornerButtons(page)) {
    (await iconColor(page, button)).forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(2));
  }
  for (const button of cornerButtons(page)) {
    await button.hover();
    await expect.poll(() => iconColor(page, button)).toEqual([255, 255, 255]);
  }
  // The "?" turns its circle white along with its glyph. (The circle has to be there: a border of no width still has a color.)
  await contactButton(page).hover();
  await expect
    .poll(() =>
      contactButton(page).evaluate((el) => {
        const s = getComputedStyle(el);
        return parseFloat(s.borderTopWidth) > 0 && s.borderTopColor === "rgb(255, 255, 255)";
      }),
    )
    .toBe(true);
});

test("every icon is the size in params.ts, and every button is its icon with 4px to spare all round", async ({ page }) => {
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".chip:not(.close)")].map((chip) => {
      const svg = chip.querySelector("svg");
      return {
        name: chip.getAttribute("aria-label"),
        box: chip.getBoundingClientRect().width,
        icon: svg ? svg.getBoundingClientRect().width : parseFloat(getComputedStyle(chip).fontSize), // the "?" is a letter
      };
    }),
  );
  expect(sizes).toHaveLength(7); // credits, clear, sound, the "?" and its three links
  for (const size of sizes) {
    expect(size.icon, `the ${size.name} icon`).toBe(params.iconSize);
    expect(size.box, `the ${size.name} button`).toBe(params.iconSize + 8);
  }
});

test("the credits button is a book, not a letter", async ({ page }) => {
  await expect(creditsButton(page).locator("svg")).toHaveCount(1);
  await expect(creditsButton(page)).toHaveText("");
});

// How big an icon looks is judged by eye (Quinn-Wai on live). This only keeps the speaker from shrinking back below its
// neighbours: the room its drawing takes, against the average of the book's and the restart arrow's, which it was a
// third short of when it was first made (0.74).
test("the speaker is about as big as the restart arrow and the book beside it", async ({ page }) => {
  const areas = await page.evaluate(() => {
    // The room an icon's drawing takes, in px squared: the box round what is on show (the speaker keeps a cross for its
    // off state, hidden), with the thickness of the line added all round.
    const area = (selector: string) => {
      const svg = document.querySelector<SVGSVGElement>(`${selector} svg`)!;
      const unit = svg.getBoundingClientRect().width / 24; // px for one of the drawing's 24 units
      const boxes = [...svg.querySelectorAll<SVGGraphicsElement>("path")]
        .filter((path) => getComputedStyle(path).display !== "none")
        .map((path) => path.getBBox());
      const width = Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x));
      const height = Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y));
      return (width + 1.8) * (height + 1.8) * unit * unit;
    };
    return { book: area(".chip.credits"), restart: area(".chip.clear"), speaker: area(".chip.sound") };
  });
  const ratio = areas.speaker / ((areas.book + areas.restart) / 2);
  expect(ratio).toBeGreaterThan(0.8);
  expect(ratio).toBeLessThan(1.25);
});

for (const [name, button] of [
  ["info", creditsButton],
  ["restart", clearButton],
  ["sound", soundToggle],
] as const) {
  test(`a ball thrown at the ${name} button bounces off it instead of passing through`, async ({ page }) => {
    expectBounce(await throwAt(page, button(page)));
  });
}

test("a ball dropped on the ? bounces off it instead of falling through", async ({ page }) => {
  const box = (await contactButton(page).boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const above = { x: centre.x, y: centre.y - 160 };
  // Carry the right-hand dot to a spot straight above the button and let it drop from there.
  const d = await dot(page, 1);
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(above.x, d.y, { steps: 8 });
  await page.mouse.move(above.x, above.y, { steps: 8 });
  await expect.poll(async () => Math.hypot((await ball(page, d.id)).x - above.x, (await ball(page, d.id)).y - above.y)).toBeLessThan(6);
  await page.waitForTimeout(120); // let it stop before letting go, so it drops straight down
  const closest = await page.evaluate(
    ({ id, at }) => {
      const sandbox = (window as any).__sandbox;
      // Let go and watch the whole fall in this one step: no frame can slip in between and move the ball unseen.
      document.getElementById("court")!.dispatchEvent(new PointerEvent("pointerup"));
      let closest = Infinity;
      for (let i = 0; i < 180; i++) {
        sandbox.advance(1 / 120);
        const b = sandbox.balls().find((ball: Ball) => ball.id === id) as Ball;
        closest = Math.min(closest, Math.hypot(b.x - at.x, b.y - at.y));
      }
      return closest;
    },
    { id: d.id, at: centre },
  );
  // A ball that had fallen through would have passed through the button's middle. A solid button keeps it a ball's radius and a button's radius apart.
  expect(closest).toBeGreaterThan(box.width / 2 + d.r - 4);
});

test("the sound toggle starts on, and nothing is stored until the visitor chooses", async ({ page }) => {
  await expect(soundToggle(page)).toHaveAttribute("aria-checked", "true");
  // A missing key means on, which is how the sound reads it too.
  expect((await stored(page))["site:sound"]).toBeUndefined();
});

test("a click flips the sound toggle between on and off, and the icon shows which it is", async ({ page }) => {
  const toggle = soundToggle(page);
  const box = (await toggle.boundingBox())!;
  // A picture of the toggle alone, with the pointer well away so that hovering does not tint it, and any fade finished.
  const picture = async () => {
    await page.mouse.move(700, 780);
    return page.screenshot({ clip: box, scale: "css", animations: "disabled" });
  };

  const on = await picture();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  const off = await picture();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const onAgain = await picture();

  expect(await differingPixels(page, off, on)).toBeGreaterThan(20); // the two states look different (waves against a cross)...
  expect(await differingPixels(page, onAgain, on)).toBe(0); // ...and the same state looks the same, so that was no noise
});

test("on a portrait phone, the turn-your-phone note sits below the row of buttons instead of running through it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const note = page.getByText("Best on a wide screen");
  await expect(note).toBeVisible();
  const noteTop = (await note.boundingBox())!.y;
  for (const button of [creditsButton(page), clearButton(page), soundToggle(page)]) {
    const box = (await button.boundingBox())!;
    expect(noteTop).toBeGreaterThanOrEqual(box.y + box.height);
  }
});

test("the sound toggle works from the keyboard", async ({ page }) => {
  const toggle = soundToggle(page);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

test("the sound toggle's choice is stored as site:sound, and survives a reload", async ({ page }) => {
  const toggle = soundToggle(page);
  const before = await stored(page);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  const after = await stored(page);
  // The one thing the click put in storage is the key that every skin of the homepage shares for this setting.
  expect(Object.keys(after).filter((key) => after[key] !== before[key])).toEqual(["site:sound"]);
  expect(after["site:sound"]).toBe("off");

  await reload(page);
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect((await stored(page))["site:sound"]).toBe("on");
  await reload(page);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

test("with browser storage blocked, the page still starts and the sound toggle still flips", async ({ page }) => {
  // Some browsers throw at the mere mention of localStorage, for instance with all cookies blocked.
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  const toggle = soundToggle(page);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("with ?tune, the buttons' tone and icon size have sliders that work, and moving the tone leaves the toy alone", async ({ page }) => {
  await page.goto("./?tune");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  const tone = page.getByLabel("button tone");
  const size = page.getByLabel("button icon size");
  const shades = async () => Promise.all(cornerButtons(page).map(async (button) => lightness(await iconColor(page, button))));

  await tone.fill("0");
  await expect.poll(async () => Math.max(...(await shades()))).toBeLessThan(0.05); // every button fades into the navy
  await tone.fill("1");
  await expect.poll(async () => Math.min(...(await shades()))).toBeGreaterThan(0.95); // every button is white

  // Only the color changes. Rebuilding the court would stop every ball in the air dead, and a rebuild makes the name's
  // layout afresh, so a new layout is how to tell. (Checked in one step, so that no ball can move in between.)
  const untouched = await page.evaluate(() => {
    const sandbox = (window as any).__sandbox;
    const slider = [...document.querySelectorAll<HTMLInputElement>("input[type=range]")].find((input) =>
      input.parentElement!.textContent!.includes("button tone"),
    )!;
    const layout = sandbox.layout();
    const balls = JSON.stringify(sandbox.balls());
    slider.value = String(Number(slider.value) === 0.5 ? 0.55 : 0.5);
    slider.dispatchEvent(new Event("input"));
    return { sameLayout: sandbox.layout() === layout, sameBalls: JSON.stringify(sandbox.balls()) === balls };
  });
  expect(untouched).toEqual({ sameLayout: true, sameBalls: true });

  await size.fill("24");
  await expect.poll(async () => (await clearButton(page).boundingBox())!.width).toBe(32); // the icon and 4px to spare all round
  expect(await clearButton(page).locator("svg").evaluate((el) => getComputedStyle(el).width)).toBe("24px");
});

test("with ?tune, bigger icons make bigger solid buttons: a ball thrown at the sound button still bounces off it", async ({ page }) => {
  await page.goto("./?tune");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  await page.getByLabel("button icon size").fill("60");
  await expect.poll(async () => (await soundToggle(page).boundingBox())!.width).toBe(68);
  expectBounce(await throwAt(page, soundToggle(page)));
});

test("a dot always comes back, and the clear button sweeps the court", async ({ page }) => {
  for (let round = 0; round < 3; round++) {
    const d = await dot(page, 0);
    await page.mouse.click(d.x - d.r * 0.8, d.y + d.r * 0.2);
    await advance(page, 4);
    expect((await sandbox<boolean[]>(page, "dots()"))[0]).toBe(true);
  }
  expect((await balls(page)).length).toBe(5);
  await page.getByRole("button", { name: "Clear the balls" }).click();
  expect((await balls(page)).length).toBe(0);
  await advance(page, 0.5);
  expect(await sandbox<boolean[]>(page, "dots()")).toEqual([true, true]);
  expect((await balls(page)).length).toBe(2);
});
