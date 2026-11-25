// The sounds, with the browser's audio replaced by a stand-in that writes down what the page asks it to
// play. Real audio cannot be heard or measured from a test, and a test must not need a sound card; what
// these checks look at is what the page decides: which file, how loud, and whether at all.

import { drag, freeze, run, until } from "./frozen";
import { expect, type Page } from "@playwright/test";
import { test } from "./test";

/** One sound the page asked the audio to start. */
interface Voice {
  url: string;
  volume: number;
  /** Where in the file it starts and how much of it plays, in seconds. */
  offset: number;
  duration: number;
}

interface AudioLog {
  /** How many audio contexts the page has made, and how many times one has been woken. */
  contexts: number;
  resumes: number;
  /** How many files have been turned into sound. */
  decoded: number;
  fetched: { url: string; status: number }[];
  voices: Voice[];
  /** The filters and limiters the page made for the way out, in the order it made them, with their numbers as they stand. */
  nodes: { kind: string; type?: string; frequency?: { value: number }; gain?: { value: number } }[];
  /** What the sound out of every voice was connected to, by chain: the kinds of node from the voice's own gain on. */
  chains: string[][];
}

/**
 * Runs in the page before anything else does. Replaces the audio context with one that records, and the
 * decoder with one that answers at once, so that a click right after the page loads finds every sound ready.
 * The real decoder is kept as `__RealOfflineAudioContext` for the check that the files really decode.
 */
function fakeAudio() {
  const log: AudioLog = { contexts: 0, resumes: 0, decoded: 0, fetched: [], voices: [], nodes: [], chains: [] };
  const w = window as any;
  w.__audio = log;

  // The fake decoder is only handed bytes, so remember which address each lot of bytes came from.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await realFetch(...args);
    log.fetched.push({ url: response.url, status: response.status });
    const arrayBuffer = response.arrayBuffer.bind(response);
    response.arrayBuffer = async () => Object.assign(await arrayBuffer(), { url: response.url });
    return response;
  };

  // How long each file is, found by a word in its name, so that a sound lasts as long as it really would.
  const lengthOf = (url: string) => (url.includes("hit") ? 4.032 : url.includes("bounce") ? 0.888 : url.includes("pop") ? 0.189 : 0.708);

  w.__RealOfflineAudioContext = w.OfflineAudioContext;
  w.OfflineAudioContext = class {
    decodeAudioData(data: ArrayBuffer & { url: string }) {
      log.decoded++;
      return Promise.resolve({ duration: lengthOf(data.url), url: data.url });
    }
  };

  // Asleep to begin with, as a browser keeps the audio of a page that nobody has touched yet.
  w.AudioContext = class {
    state = "suspended";
    destination = { kind: "destination" };
    constructor() {
      log.contexts++;
    }
    get currentTime() {
      return performance.now() / 1000;
    }
    resume() {
      log.resumes++;
      this.state = "running";
      return Promise.resolve();
    }
    suspend() {
      this.state = "suspended";
      return Promise.resolve();
    }
    createGain() {
      const gain: any = {
        kind: "gain",
        gain: { value: 1, setTargetAtTime() {} },
        connect(to: unknown) {
          gain.to = to;
        },
      };
      return gain;
    }
    createDynamicsCompressor() {
      const limiter: any = {
        kind: "limiter",
        threshold: { value: -24 },
        knee: { value: 30 },
        ratio: { value: 12 },
        attack: { value: 0.003 },
        release: { value: 0.25 },
        connect(to: unknown) {
          limiter.to = to;
        },
      };
      log.nodes.push(limiter);
      return limiter;
    }
    createBufferSource() {
      let into: { gain: { value: number }; to?: any };
      const source = {
        buffer: null as { url: string } | null,
        connect(node: typeof into) {
          into = node;
        },
        start(_when: number, offset: number, duration: number) {
          log.voices.push({ url: source.buffer!.url, volume: into.gain.value, offset, duration });
          const chain: string[] = [];
          for (let node = into.to; node; node = node.to) chain.push(node.kind === "filter" ? node.type : node.kind);
          log.chains.push(chain);
        },
        stop() {},
      };
      return source;
    }
  };
}

/** The word that tells each sound's file from the others, so that these checks do not just copy the table in sound.ts. */
const FILE = { hit: "tennis-ball-hit", bounce: "bounce", rising: "suction-pop", out: "soft-whoosh" };

interface Ball {
  id: number;
  pinned: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const sandbox = <T>(page: Page, call: string) => page.evaluate(`window.__sandbox.${call}`) as Promise<T>;
const balls = (page: Page) => sandbox<Ball[]>(page, "balls()");
const ball = async (page: Page, id: number) => (await balls(page)).find((b) => b.id === id)!;
const advance = (page: Page, seconds: number) => sandbox<void>(page, `advance(${seconds})`);
const voices = (page: Page) => page.evaluate(() => (window as any).__audio.voices as Voice[]);
const voicesOf = async (page: Page, sound: keyof typeof FILE) => (await voices(page)).filter((v) => v.url.includes(FILE[sound]));
const volumeOf = (page: Page, name: string) => page.evaluate((key) => (window as any).__sandbox.params[key] as number, name);
/** The ball currently sitting as the dot of the first or second "i". */
const dot = (page: Page, index: number) =>
  page.evaluate((i) => {
    const s = (window as any).__sandbox;
    const home = s.layout().dots[i];
    return s.balls().find((b: Ball) => b.pinned && Math.hypot(b.x - home.x, b.y - home.y) < 2) as Ball;
  }, index);

/** Open the page with the audio stubbed out, and wait until the sound files are fetched and turned into sound. */
async function open(page: Page, options: { soundSetting?: string | null; address?: string } = {}) {
  await page.addInitScript(fakeAudio);
  // Most of these checks compare with the volumes in the settings, so unless a check says which setting it wants, the
  // sound is on at full gain (the quiet level is set aside); `null` stores nothing, as for a visitor who has not pressed the button.
  const fullGain = options.soundSetting === undefined;
  const setting = fullGain ? "on" : options.soundSetting;
  if (setting) await page.addInitScript((value) => localStorage.setItem("site:sound", value), setting);
  await page.goto(options.address ?? "./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  if (fullGain) await page.evaluate(() => ((window as any).__sandbox.params.soundGain = 1));
  await page.waitForFunction("window.__audio.decoded === 4");
}

/**
 * Hit a dot from its left side, which sends it off to the right, clear of the stem it stood over. The first dot, unless
 * told otherwise: with ?tune the panel of sliders covers the left of a window as narrow as a phone's, the first dot with it.
 */
async function knockOffDot(page: Page, index = 0) {
  const d = await dot(page, index);
  await page.mouse.click(d.x - d.r * 0.8, d.y + d.r * 0.2);
  return d;
}
const knockOffFirstDot = (page: Page) => knockOffDot(page, 0);

/**
 * The window the toy is in, as a drop needs to know it. How hard a ball lands depends on how far it falls in meters and
 * not in pixels, and a window is 800px tall on a laptop and about 340 on a phone held sideways, so spots for a drop are
 * worked out from the floor, the ball's radius and the pixels in a meter. The bare floor to the left of the name has the
 * corner buttons nowhere near it, however narrow the window.
 */
async function dropGround(page: Page) {
  const { nameLeft, floor, perMeter, r } = await page.evaluate(() => {
    const s = (window as any).__sandbox;
    const letters = s.layout().letters as { loops: { x: number; y: number }[][] }[];
    return {
      nameLeft: Math.min(...letters.flatMap((l) => l.loops.flat()).map((p) => p.x)),
      floor: innerHeight,
      perMeter: s.pxPerMeter() as number,
      r: (s.balls()[0] as Ball).r,
    };
  });
  const near = r + 2; // a ball's middle can be this close to the wall...
  const far = nameLeft - r - 6; // ...and this close to the name's first letter
  /**
   * A spot for the ball's middle, `share` of the way across that floor (0 to 1), from which it falls `fall` meters. No
   * higher than the window's top, so the most it can fall is a little less than the window is tall.
   */
  return (share: number, fall: number) => ({
    x: near + share * (far - near),
    y: Math.max(r + 8, floor - r - fall * perMeter),
  });
}

/**
 * Pick up the second dot, carry it to `at` by way of the open air above the name, and let go once it is
 * still, so that it drops straight down from there.
 */
async function dropSecondDotFrom(page: Page, at: { x: number; y: number }) {
  await freeze(page);
  const d = await dot(page, 1);
  // Four radii above the dots is clear of the first dot, the name and the buttons at the top right, in a window of any size.
  const over = d.y - 4 * d.r;
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await drag(page, d, { x: d.x, y: over }, 6);
  await drag(page, { x: d.x, y: over }, { x: at.x, y: over }, 10);
  await drag(page, { x: at.x, y: over }, at, 6);
  await until(page, async () => { const b = await ball(page, d.id); return Math.hypot(b.x - at.x, b.y - at.y); }, (gap) => gap < 4, "the ball arrives at the spot");
  await run(page, 0.15); // let it stop, so that it falls straight down
  await page.mouse.up();
  return d;
}

// Nothing in the toy makes a sound without a gesture, so this cannot show that a sound asked for early would be
// refused; src/sound.test.ts does that. What it shows is that the page itself wakes the audio on a gesture and not
// before, and that it makes the audio at the start, before anyone could be in the middle of a press.
test("the audio is made at the start and left asleep until the visitor does something, and that wakes it", async ({ page }) => {
  const audio = () => page.evaluate(() => ({ contexts: (window as any).__audio.contexts, resumes: (window as any).__audio.resumes }));
  await open(page);
  await advance(page, 3);
  expect(await audio()).toEqual({ contexts: 1, resumes: 0 });
  expect(await voices(page)).toEqual([]);

  await page.mouse.click(8, page.viewportSize()!.height / 2); // the empty left edge: a gesture, but not a hit
  expect(await audio()).toEqual({ contexts: 1, resumes: 1 }); // the same audio, woken
  expect(await voices(page)).toEqual([]);
});

test("the four sound files are fetched from addresses relative to the page, and every one is found", async ({ page }) => {
  await open(page);
  const fetched = await page.evaluate(() => (window as any).__audio.fetched as AudioLog["fetched"]);
  expect(fetched).toHaveLength(4);
  const folder = new URL("./tennis/sounds/", page.url()).href;
  for (const sound of Object.values(FILE)) {
    expect(fetched.filter((f) => f.url.startsWith(folder) && f.url.includes(sound) && f.status === 200)).toHaveLength(1);
  }
});

test("hitting a ball plays the hit sound once, at the hit volume", async ({ page }) => {
  await open(page);
  await knockOffFirstDot(page);
  const hits = await voicesOf(page, "hit");
  expect(hits).toHaveLength(1);
  expect(hits[0].volume).toBeCloseTo(await volumeOf(page, "soundHit"));
  expect(hits[0].offset).toBeGreaterThan(0.02); // it skips the silence the encoder left in front of it
});

test("a ball that strikes the floor or a letter plays the bounce sound, and not once it has come to rest", async ({ page }) => {
  await open(page);
  await knockOffFirstDot(page);
  await advance(page, 6);
  const bounces = await voicesOf(page, "bounce");
  expect(bounces.length).toBeGreaterThan(2);
  const full = await volumeOf(page, "soundBounce");
  for (const bounce of bounces) {
    expect(bounce.volume).toBeGreaterThan(0);
    expect(bounce.volume).toBeLessThanOrEqual(full);
  }
  // The ball has settled by now, and a settled ball makes no more sound.
  const heard = (await voices(page)).length;
  await advance(page, 3);
  expect((await voices(page)).length).toBe(heard);
});

test("a ball dropped from higher strikes the floor harder and plays the bounce louder", async ({ page }) => {
  await open(page);
  // Two clear stretches of floor to the left of the name, one for each ball. A fall of 0.3 m lands at about 2.4 m/s, and
  // the highest the window allows at about 4.4 to 4.7 (on a laptop that is a fall of 1.14 m; a phone held sideways is not
  // quite a meter tall).
  const spot = await dropGround(page);
  await dropSecondDotFrom(page, spot(0.25, 0.3));
  await advance(page, 4); // it settles, and a fresh ball rises out of the "i" to be dropped next
  const lowDrop = (await voicesOf(page, "bounce")).length;
  expect(lowDrop).toBeGreaterThan(0);
  await dropSecondDotFrom(page, spot(0.75, 1.14));
  await advance(page, 4);
  const bounces = (await voicesOf(page, "bounce")).map((v) => v.volume);
  const [soft, hard] = [bounces[0], bounces[lowDrop]]; // the first thing each ball struck was the floor
  expect(soft).toBeGreaterThan(0);
  expect(hard).toBeGreaterThan(soft * 1.5);
  // Each ball's first strike is its hardest, since every bounce after it is softer, which is also how to tell that
  // these are the two strikes meant and not something else that happened in between.
  expect(soft).toBe(Math.max(...bounces.slice(0, lowDrop)));
  expect(hard).toBe(Math.max(...bounces.slice(lowDrop)));
});

test("a fresh ball rising out of an i plays the rising sound, once for each rise", async ({ page }) => {
  await open(page);
  await knockOffFirstDot(page);
  expect(await voicesOf(page, "rising")).toHaveLength(0); // the dot has only just been knocked off
  await advance(page, 4);
  const rising = await voicesOf(page, "rising");
  expect(rising).toHaveLength(1);
  expect(rising[0].volume).toBeCloseTo(await volumeOf(page, "soundRising"));
  expect(await sandbox<boolean[]>(page, "dots()")).toEqual([true, true]); // and the dot really is back
});

test("a ball that leaves past the side lines above the window plays the ball-out sound", async ({ page }) => {
  await open(page);
  await page.evaluate(() => ((window as any).__sandbox.params.hitSpeed = 12)); // hard enough to clear the top of the window
  const d = await dot(page, 1);
  // From below and a little to the right: up and to the left. Not to the right, where the buttons at the top right are: in a
  // window as short as a phone's held sideways a ball sent up and to the right meets them, and bounces back into the court.
  await page.mouse.click(d.x + d.r * 0.35, d.y + d.r * 0.9);
  expect(await voicesOf(page, "out")).toHaveLength(0); // it has not gone yet
  await advance(page, 1);
  expect((await balls(page)).find((b) => b.id === d.id)).toBeUndefined(); // it has
  const out = await voicesOf(page, "out");
  expect(out).toHaveLength(1);
  expect(out[0].volume).toBeCloseTo(await volumeOf(page, "soundOut"));
});

test("with sound switched off, none of the four sounds plays; switched on again, they do", async ({ page }) => {
  await open(page, { soundSetting: "off" });
  await page.mouse.click(8, page.viewportSize()!.height / 2); // the empty left edge: a gesture, but not a hit
  await page.evaluate(() => ((window as any).__sandbox.params.hitSpeed = 12));
  const d = await dot(page, 1);
  await page.mouse.click(d.x + d.r * 0.35, d.y + d.r * 0.9); // sends it up and to the left, out of the window (see the check above)
  // The next hit is an ordinary one. At 12 m/s the ball is sent against the right wall and back, and in a window as short as
  // a phone's it can come to rest on the "a" beside the last "i", where it keeps that dot from coming back (a fresh ball only
  // rises when nothing sits by the stem). An ordinary hit lands the ball on the floor, bounces it and lets the dot be replaced.
  await page.evaluate(() => ((window as any).__sandbox.params.hitSpeed = 3));
  await knockOffFirstDot(page); // lands, bounces and is replaced
  await advance(page, 6);
  // Everything that makes a sound happened: the hit, the bounces, the rising and the ball leaving...
  expect(await sandbox(page, "lastHit()")).not.toBeNull();
  expect((await balls(page)).find((b) => b.id === d.id)).toBeUndefined();
  expect(await sandbox<boolean[]>(page, "dots()")).toEqual([true, true]);
  // ...and not one of them was heard.
  expect(await voices(page)).toEqual([]);

  // The setting is read each time, so switching sound on needs no reload.
  await page.evaluate(() => localStorage.setItem("site:sound", "on"));
  await page.evaluate(() => ((window as any).__sandbox.params.hitSpeed = 3));
  await knockOffFirstDot(page);
  expect((await voicesOf(page, "hit")).length).toBe(1);
});

// The test above sets the stored value directly. This one uses the sound button itself, so that the button that writes
// the setting and the sound that reads it are shown to agree about the key and the words.
test("the sound button flips between on and off: nothing is heard at off, and on is quiet", async ({ page }) => {
  await open(page, { soundSetting: null });
  const button = page.getByRole("button", { name: /^Sound/ });
  await expect(button).toHaveAttribute("aria-label", "Sound: on"); // a new visitor starts on
  const hitVolume = async () => {
    await page.evaluate(() => ((window as any).__sandbox.params.hitSpeed = 3));
    await knockOffFirstDot(page);
    const hits = await voicesOf(page, "hit");
    return hits[hits.length - 1]?.volume;
  };
  const full = await volumeOf(page, "soundHit");
  const on = await hitVolume();
  expect(on).toBeCloseTo(full * (await volumeOf(page, "soundGain")));
  expect(on).toBeLessThan(full);

  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Sound: off");
  await advance(page, 6);
  const heard = (await voices(page)).length;
  await advance(page, 6);
  await knockOffFirstDot(page);
  await advance(page, 6);
  expect(await sandbox(page, "lastHit()")).not.toBeNull();
  expect((await voices(page)).length).toBe(heard); // the hit, the bounces and the rising ball happened, and none was heard

  // The setting is read at each sound, so the next click needs no reload.
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Sound: on");
  await knockOffFirstDot(page);
  expect((await voices(page)).length).toBeGreaterThan(heard);
});

test("every sound passes the limiter and nothing else (no tone filter) on its way out", async ({ page }) => {
  await open(page);
  await knockOffFirstDot(page);
  const { chains, nodes } = await page.evaluate(() => (window as any).__audio as AudioLog);
  expect(chains.length).toBeGreaterThan(0);
  for (const chain of chains) expect(chain).toEqual(["limiter", "destination"]);
  expect(nodes.some((n) => n.kind === "filter")).toBe(false);
});

test("with the browser's own Web Audio, the sounds are made without a complaint and the toy keeps going", async ({ page }) => {
  // No stand-in here: whatever the page asks of the real audio, the real audio must accept (a wrong type of filter or a
  // number out of range would throw, and the page would then switch its sound off with a warning).
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") warnings.push(message.text());
  });
  await page.addInitScript(() => localStorage.setItem("site:sound", "on"));
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
  await page.waitForTimeout(500); // the files are fetched and decoded
  await page.evaluate(() => ((window as any).__sandbox.params.hitSpeed = 3));
  await knockOffFirstDot(page);
  await advance(page, 4);
  expect(await sandbox<boolean[]>(page, "dots()")).toEqual([true, true]);
  expect(warnings.filter((text) => /sound/i.test(text))).toEqual([]);
});

test("no setting stored means on", async ({ page }) => {
  await open(page, { soundSetting: null });
  expect(await page.evaluate(() => localStorage.getItem("site:sound"))).toBeNull();
  await expect(page.getByRole("button", { name: "Sound: on" })).toBeVisible();
  await knockOffFirstDot(page);
  const hits = await voicesOf(page, "hit");
  expect(hits.length).toBe(1);
  expect(hits[0].volume).toBeLessThan(await volumeOf(page, "soundHit"));
});

test("another skin's stored on still plays sound", async ({ page }) => {
  await open(page, { soundSetting: "on" });
  await expect(page.getByRole("button", { name: "Sound: on" })).toBeVisible();
  await knockOffFirstDot(page);
  expect((await voicesOf(page, "hit")).length).toBe(1);
});

test("the files really decode in the browser, and start with the silence the page skips over", async ({ page }) => {
  await open(page);
  const decoded = await page.evaluate(async () => {
    const w = window as any;
    const decoder = new w.__RealOfflineAudioContext(1, 1, 44100);
    const out: Record<string, { duration: number; quietUntil: number }> = {};
    const urls = (w.__audio.fetched as { url: string }[]).map((f) => f.url); // a copy: fetching adds to the list
    for (const url of urls) {
      const buffer = await decoder.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const samples = buffer.getChannelData(0) as Float32Array;
      let first = 0;
      while (first < samples.length && Math.abs(samples[first]) < 0.001) first++;
      out[url.split("/").pop()!] = { duration: buffer.duration, quietUntil: first / buffer.sampleRate };
    }
    return out;
  });
  const find = (word: string) => Object.entries(decoded).find(([name]) => name.includes(word))![1];
  expect(find(FILE.hit).duration).toBeCloseTo(4.03, 1);
  expect(find(FILE.bounce).duration).toBeCloseTo(0.888, 1);
  expect(find(FILE.rising).duration).toBeCloseTo(0.189, 1);
  expect(find(FILE.out).duration).toBeCloseTo(0.708, 1);
  // The offsets in sound.ts are the silence in front of the hit and the bounce: the sound has not started before them...
  expect(find(FILE.hit).quietUntil).toBeGreaterThan(0.02);
  expect(find(FILE.bounce).quietUntil).toBeGreaterThan(0.04);
  // ...and has by a few milliseconds after, so skipping them cuts nothing off.
  expect(find(FILE.hit).quietUntil).toBeLessThan(0.03);
  expect(find(FILE.bounce).quietUntil).toBeLessThan(0.055);
});

test("with ?tune, every sound number has a slider that takes effect on the next sound and leaves the court alone", async ({ page }) => {
  await open(page, { address: "./?tune", soundSetting: "on" });
  const sliders = page.locator("label", { hasText: "sound:" }).locator("input[type=range]");
  const numbers = ["soundHit", "soundBounce", "soundRising", "soundOut", "soundBounceMinSpeed", "soundBounceFullSpeed", "soundMaxVoices", "soundGain"];
  await expect(sliders).toHaveCount(numbers.length);
  // Each slider starts at the number in params, which is the one it will change.
  const start = await page.evaluate(
    (keys) => keys.map((key) => (window as any).__sandbox.params[key] as number),
    numbers,
  );
  expect(await sliders.evaluateAll((all) => all.map((input) => Number((input as HTMLInputElement).value)))).toEqual(start);

  // The hit volume: move its slider, and the next hit plays at the new volume. The second dot is the one to hit: the panel
  // of sliders sits at the left of the window, and in a window as narrow as a phone's it covers the first dot.
  await page.getByLabel("sound: hit volume").fill("0.2");
  expect(await volumeOf(page, "soundHit")).toBeCloseTo(0.2);
  await knockOffDot(page, 1);
  expect((await voicesOf(page, "hit"))[0].volume).toBeCloseTo(0.2 * (await volumeOf(page, "soundGain"))); // the level when on still applies

  // Moving a slider must leave the toy alone: a rebuilt court would stop every ball in the air, and makes the
  // name's layout afresh, so a new layout is how to tell. (Checked in one step, so that no ball moves between.)
  const untouched = await page.evaluate(() => {
    const hook = (window as any).__sandbox;
    const layout = hook.layout();
    const balls = JSON.stringify(hook.balls());
    for (const input of document.querySelectorAll<HTMLInputElement>("input[type=range]")) {
      if (!input.parentElement!.textContent!.startsWith("sound:")) continue;
      input.value = String(Number(input.value) === Number(input.max) ? Number(input.min) : Number(input.max));
      input.dispatchEvent(new Event("input"));
    }
    return { sameLayout: hook.layout() === layout, sameBalls: JSON.stringify(hook.balls()) === balls };
  });
  expect(untouched).toEqual({ sameLayout: true, sameBalls: true });
});

// ---- Restart and the cans (QWW-85) ----

/** Unzip the bag from the keyboard, as a visitor without a pointer would, and give what is in it time to come up. */
async function unzipByKeyboard(page: Page) {
  await page.getByRole("slider", { name: /Unzip the bag/ }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => page.evaluate(() => (window as any).__sandbox.bag().open)).toBe(true);
  await page.waitForTimeout(1000);
}

test("Restart brings the dots back without the rising sound, and so does opening the bag; a knocked-off dot keeps its own", async ({ page }) => {
  await open(page);
  await unzipByKeyboard(page);
  expect(await voices(page), "the bag opening makes no sound").toHaveLength(0);
  await page.getByRole("button", { name: "Clear the balls" }).click();
  await advance(page, 3);
  expect(await sandbox<boolean[]>(page, "dots()"), "the dots are back").toEqual([true, true]);
  expect(await voicesOf(page, "rising"), "and came back silently").toHaveLength(0);
  await knockOffFirstDot(page);
  await advance(page, 4);
  expect(await voicesOf(page, "rising"), "a dot that regrows after being knocked off keeps its pop").toHaveLength(1);
});

test("a can makes no sound when it lands, and a tap on it plays no hit and puts it back where it stood", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await unzipByKeyboard(page);
  const before = (await voices(page)).length;
  const rises = (await page.locator(".v6-rise").first().boundingBox())!;
  const lift = await page.evaluate(() => (matchMedia("(pointer: coarse)").matches ? (window as any).__sandbox.params.floorLiftPx : 0));
  const moveTo = async (from: [number, number], to: [number, number], moves = 20) => {
    for (let i = 1; i <= moves; i++) {
      await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / moves, from[1] + ((to[1] - from[1]) * i) / moves);
      await advance(page, 1 / 60);
    }
  };
  const top: [number, number] = [rises.x + rises.width / 2, rises.y + 8];
  await page.mouse.move(...top);
  await page.mouse.down();
  await moveTo(top, [top[0] - 40, top[1] - 60], 6);
  const height = (await page.evaluate(() => (window as any).__sandbox.cans()))[0].height as number;
  const floor = await page.evaluate(() => innerHeight);
  await moveTo([top[0] - 40, top[1] - 60], [100, floor - lift - height - 10], 30);
  await advance(page, 1.5);
  await page.mouse.up();
  await advance(page, 3);
  expect(await voices(page), "a can that landed made no sound").toHaveLength(before);
  const can = (await page.evaluate(() => (window as any).__sandbox.cans()))[0] as { x: number; y: number; height: number };
  await page.mouse.click(can.x, can.y + can.height * 0.25); // a tap on its body (QWW-100: it pours, and goes back where it stood)
  await advance(page, 3);
  const after = (await page.evaluate(() => (window as any).__sandbox.cans()))[0] as { x: number; y: number };
  expect(Math.abs(after.y - can.y), "the can is back where it stood").toBeLessThan(2);
  expect(Math.abs(after.x - can.x)).toBeLessThan(2);
  expect(await voicesOf(page, "hit"), "and played no hit").toHaveLength(0);
});
