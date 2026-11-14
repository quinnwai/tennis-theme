// The checks that say the first draft is done, run in a real browser against the dev server or,
// with BASE_URL set, against a deployed copy.

import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

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
  await page.mouse.move(d.x + 400, d.y - 100, { steps: 5 });
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
  const d = await dot(page, 1);
  // Carry the right-hand dot toward the right wall and let it go while it is still moving.
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(1400, d.y + 40, { steps: 5 });
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
  const first = (await credits(page).getByRole("listitem").first().boundingBox())!;
  expect(first.y).toBeGreaterThanOrEqual(0);
});

test("a click outside the credit text closes the credits, and does not hit the ball under it", async ({ page }) => {
  await openCredits(page);
  const text = (await credits(page).locator(".credits-text").boundingBox())!;
  const second = await dot(page, 1);
  expect(text.x + text.width).toBeLessThan(second.x - second.r); // this dot is clear of the text

  // A click on the text itself leaves the credits open...
  await credits(page).getByText("the colors").click();
  await expect(credits(page)).toBeVisible();
  // ...and so does a press on the text that lets go beside it, as when selecting a name to copy...
  const line = (await credits(page).getByText("the letters").boundingBox())!;
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

test("the credit text says word for word what CITATIONS.md says", async ({ page }) => {
  const markdown = readFileSync(new URL("../CITATIONS.md", import.meta.url), "utf8");
  const items = markdown.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
  const link = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = items.flatMap((item) => [...item.matchAll(link)].map(([, text, href]) => ({ text, href })));
  expect(items.length).toBeGreaterThan(0);

  await openCredits(page);
  await expect(credits(page).getByRole("listitem")).toHaveText(items.map((item) => item.replace(link, "$1")));
  await expect(credits(page).getByRole("link")).toHaveCount(links.length);
  for (const { text, href } of links) {
    await expect(credits(page).getByRole("link", { name: text, exact: true })).toHaveAttribute("href", href);
  }
});

test("with ?tune, the blur and the dimming have sliders that work while the credits are open", async ({ page }) => {
  await page.goto("./?tune");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  // Put a ball in the air first, so there is something moving behind the credits when they open.
  const d = await dot(page, 0);
  await page.mouse.click(d.x, d.y + d.r * 0.8);
  await advance(page, 0.1);
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

  // Tuning the credits' look leaves the toy behind them alone. Rebuilding the court would stop the ball in the
  // air dead, so every ball must be exactly as it was a moment ago (all in one go, with no frame in between).
  const moved = await page.evaluate(() => {
    const sandbox = (window as any).__sandbox;
    const slider = [...document.querySelectorAll<HTMLInputElement>("input[type=range]")].find((input) =>
      input.parentElement!.textContent!.includes("credits blur"),
    )!;
    const balls = () => JSON.stringify(sandbox.balls());
    const was = balls();
    slider.value = String(Number(slider.value) === 25 ? 24 : 25);
    slider.dispatchEvent(new Event("input"));
    return { was, now: balls(), flying: sandbox.balls().some((b: Ball) => !b.pinned && Math.hypot(b.vx, b.vy) > 100) };
  });
  expect(moved.flying).toBe(true);
  expect(moved.now).toBe(moved.was);
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
