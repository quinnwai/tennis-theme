// Measuring a visit, checked in a real browser: the page's own code runs, and the network call it makes is
// caught and answered by the test, so nothing a test does ever reaches the real PostHog project. That holds
// against the dev server and, with BASE_URL set, against a deployed copy.

import { expect, type BrowserContext, type Page } from "@playwright/test";
import { test } from "./test";

const ENDPOINT = "https://us.i.posthog.com/i/v0/e/";

/** One thing the page sent to PostHog. */
interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: { api_key: string; event: string; distinct_id: string; properties: Record<string, unknown> };
}

interface Ball {
  id: number;
  pinned: boolean;
  x: number;
  y: number;
  r: number;
}

/**
 * Catch everything the page sends to any PostHog address and answer it from here. Set up on the context, so it
 * is still in place when the browser closes a page, which is when a visit can still be on its way out.
 */
async function catchVisits(context: BrowserContext): Promise<Sent[]> {
  const sent: Sent[] = [];
  await context.route("https://*.posthog.com/**", async (route) => {
    const request = route.request();
    sent.push({ url: request.url(), method: request.method(), headers: request.headers(), body: request.postDataJSON() });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": new URL(request.frame().url()).origin,
        "access-control-allow-credentials": "true",
        // An answer that tries to set a cookie, the way a server could. See the privacy test below.
        "set-cookie": "stray=1; Path=/; Secure; SameSite=None",
      },
      body: '{"status":"Ok"}',
    });
  });
  return sent;
}

/** Make the page believe its tab was hidden or shown again, which is what switching tabs does. */
const setVisibility = (page: Page, state: "hidden" | "visible") =>
  page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

/** The ball sitting as the dot of the first or second "i". */
const dot = (page: Page, index: number) =>
  page.evaluate((i) => {
    const s = (window as any).__sandbox;
    const home = s.layout().dots[i];
    return s.balls().find((b: Ball) => b.pinned && Math.hypot(b.x - home.x, b.y - home.y) < 2) as Ball;
  }, index);

const hit = async (page: Page, index: number) => {
  const d = await dot(page, index);
  await page.mouse.click(d.x, d.y + d.r * 0.8);
};

/** Pick a ball up, hold it still for a while, and let go. */
async function carry(page: Page, index: number, holdMs: number) {
  const d = await dot(page, index);
  await page.mouse.move(d.x, d.y);
  await page.mouse.down();
  await page.mouse.move(d.x + 60, d.y - 80, { steps: 8 });
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

/** Drag the bag's pull to the end of the zip, which opens the bag, and give the cans and the notebook the time to come up. */
async function unzipBag(page: Page) {
  const pull = (await page.evaluate("window.__sandbox.bag().pull")) as [number, number];
  const end = (await page.evaluate("window.__sandbox.zipPoint(1)")) as [number, number];
  await page.mouse.move(pull[0], pull[1]);
  await page.mouse.down();
  await page.mouse.move(end[0], end[1], { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction("window.__sandbox.bag().open");
  await page.waitForTimeout(1000);
}

/** Where the part of item `i` of the bag that shows is, as the page draws it (the cans are 0 to 2, the notebook 3). */
const itemBox = (page: Page, i: number) =>
  page.evaluate((i) => {
    const r = document.querySelectorAll(".v6-rise")[i].getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width };
  }, i);

const loaded = async (page: Page) => {
  await page.goto("./");
  await page.waitForFunction("window.__sandbox && window.__sandbox.balls().length === 2");
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test.describe("a visitor's browser", () => {
  let sent: Sent[];

  test.beforeEach(async ({ context }) => {
    sent = await catchVisits(context);
    // Browsers under automation say so, and the page then measures nothing. This is the same browser, saying it is a person's.
    await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
    // Write down how the page asks for each request to PostHog. A real page close is the one moment a browser under
    // test cannot show a request, so this is how `keepalive`, which lets the request outlive the page, stays checked.
    await context.addInitScript(() => {
      const asked: { credentials?: string; keepalive?: boolean }[] = [];
      Object.assign(window, { __askedPostHog: asked });
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (String(input).includes("posthog.com")) asked.push({ credentials: init?.credentials, keepalive: init?.keepalive });
        return real(input, init);
      };
    });
  });

  test.afterEach(async ({ page }) => {
    // Whatever a test left under way ends here, inside the stub, rather than when the browser closes the page.
    if (page.isClosed()) return;
    await setVisibility(page, "hidden").catch(() => {});
    await page.waitForTimeout(250);
  });

  test("a visit with play sends both numbers, tagged tennis, when the tab is hidden", async ({ page }) => {
    await loaded(page);
    await page.waitForTimeout(1500); // looking around first
    await hit(page, 0);
    await page.waitForTimeout(500);
    await carry(page, 1, 1500); // picking a ball up and holding it counts as play, not only hits
    expect(sent, "nothing is sent while the visitor is still there").toHaveLength(0);

    await setVisibility(page, "hidden");
    await expect.poll(() => sent.length).toBe(1);

    expect(sent[0].url).toBe(ENDPOINT);
    expect(sent[0].method).toBe("POST");
    expect(sent[0].body.event).toBe("homepage_visit");
    expect(sent[0].body.properties.skin).toBe("tennis");
    const { first_interaction_s: first, play_s: play } = sent[0].body.properties as { first_interaction_s: number; play_s: number };
    // The first hit came after the 1.5 s look around, a few seconds into the page's life at most.
    expect(first).toBeGreaterThanOrEqual(1.5);
    expect(first).toBeLessThan(10);
    // From the hit to the let-go: 0.5 s, then a carry held for 1.5 s. With only hits counted, play would be 0.
    expect(play).toBeGreaterThanOrEqual(1.9);
    expect(play).toBeLessThan(15);
  });

  test("a visitor who never touches a ball is a visit too: no first-interaction time, play 0", async ({ page }) => {
    await loaded(page);
    await page.waitForTimeout(300);
    await setVisibility(page, "hidden");
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body.properties).not.toHaveProperty("first_interaction_s");
    expect(sent[0].body.properties.play_s).toBe(0);
    expect(sent[0].body.properties.skin).toBe("tennis");
  });

  // Playing with the bag, the notebook and the cans is playing with the toy, like hitting and carrying a ball (QWW-85).

  test("unzipping the bag is the first interaction: it ends the look around and starts the play", async ({ page }) => {
    await loaded(page);
    await page.waitForTimeout(1500); // looking around first
    await unzipBag(page);
    await setVisibility(page, "hidden");
    await expect.poll(() => sent.length).toBe(1);
    const { first_interaction_s: first } = sent[0].body.properties as { first_interaction_s: number };
    expect(first, "the zip is the first thing done, after the look around").toBeGreaterThanOrEqual(1.5);
    expect(first).toBeLessThan(10);
  });

  test("a plain click on the bag or on its pull is not an interaction: the visit has none", async ({ page }) => {
    await loaded(page);
    const L = (await page.evaluate("window.__sandbox.scene()")) as { bagAt: [number, number]; k: number };
    const pull = (await page.evaluate("window.__sandbox.bag().pull")) as [number, number];
    await page.mouse.click(L.bagAt[0] + 150 * L.k, L.bagAt[1] - 100 * L.k);
    await page.mouse.click(pull[0], pull[1]); // on the pull, without moving it
    await setVisibility(page, "hidden");
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body.properties).not.toHaveProperty("first_interaction_s");
    expect(sent[0].body.properties.play_s).toBe(0);
  });

  test("opening the notebook is play: it carries the end of the visit's play on to that moment", async ({ page }) => {
    await loaded(page);
    await unzipBag(page);
    await page.waitForTimeout(1600); // nothing touched for a while after the zip
    await page.getByRole("button", { name: "Open the notebook" }).click();
    await setVisibility(page, "hidden");
    await expect.poll(() => sent.length).toBe(1);
    // From the unzip to the click on the notebook. With only the unzip counted, play would be a fraction of a second.
    expect(sent[0].body.properties.play_s as number).toBeGreaterThanOrEqual(1.5);
    expect(sent[0].body.properties.play_s as number).toBeLessThan(15);
  });

  test("picking up a can is play too", async ({ page }) => {
    await loaded(page);
    await unzipBag(page);
    await page.waitForTimeout(1600);
    const box = await itemBox(page, 2);
    await page.mouse.move(box.left + box.width / 2, box.top + 8);
    await page.mouse.down();
    await page.mouse.move(box.left + box.width / 2 - 20, box.top - 40, { steps: 6 });
    await page.mouse.up();
    await setVisibility(page, "hidden");
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body.properties.play_s as number).toBeGreaterThanOrEqual(1.5);
    expect(sent[0].body.properties.play_s as number).toBeLessThan(15);
  });

  test("a visit is sent once, however many times the page says it is being left", async ({ page }) => {
    await loaded(page);
    await hit(page, 0);
    await setVisibility(page, "hidden");
    await setVisibility(page, "hidden");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(() => sent.length).toBe(1);
    await page.waitForTimeout(400);
    expect(sent).toHaveLength(1);
  });

  // Not tested here: a page that is really closed or navigated away. A browser under test cannot see a request
  // made while a page is unloading (a route never gets it), so the events above stand in for that moment.

  test("a page brought back from the back button starts a new visit, even with no visibilitychange (Safari)", async ({ page }) => {
    await loaded(page);
    await hit(page, 0);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide"))); // into the back-forward cache
    await expect.poll(() => sent.length).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow"))); // and back out again
    await hit(page, 1);
    await setVisibility(page, "hidden");
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1].body.distinct_id).not.toBe(sent[0].body.distinct_id);
  });

  test("a page that opens in a background tab is timed from the moment the tab is first shown", async ({ page, context }) => {
    await context.addInitScript(() => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }));
    await loaded(page);
    await page.waitForTimeout(2000); // open in the background, unseen
    await setVisibility(page, "visible");
    await hit(page, 0);
    await setVisibility(page, "hidden");
    await expect.poll(() => sent.length).toBe(1);
    // The 2 s unseen are not counted; if they were, this would be at least 2.
    expect(sent[0].body.properties.first_interaction_s as number).toBeLessThan(1.5);
  });

  test("a hidden tab that comes back starts a new visit, timed from the return; a glance back is not reported", async ({ page }) => {
    await loaded(page);
    await page.waitForTimeout(1000);
    await hit(page, 0);
    await setVisibility(page, "hidden");
    await expect.poll(() => sent.length).toBe(1);

    await page.waitForTimeout(2500); // the time away
    await setVisibility(page, "visible");
    await hit(page, 1);
    await setVisibility(page, "hidden");
    await expect.poll(() => sent.length).toBe(2);

    await setVisibility(page, "visible"); // a glance back, nothing touched
    await setVisibility(page, "hidden");
    await page.waitForTimeout(400);
    expect(sent, "the glance back adds nothing").toHaveLength(2);

    const [first, second] = sent.map((s) => s.body.properties as { first_interaction_s: number; play_s: number });
    expect(first.first_interaction_s).toBeGreaterThanOrEqual(1);
    // The 2.5 s away is in neither visit: the second one is timed from the return, and had one interaction.
    expect(second.first_interaction_s).toBeLessThan(2);
    expect(second.play_s).toBe(0);
    expect(sent[0].body.distinct_id).toMatch(UUID);
    expect(sent[1].body.distinct_id).toMatch(UUID);
    expect(sent[1].body.distinct_id, "each visit has an id of its own").not.toBe(sent[0].body.distinct_id);
  });

  test("no cookie is set, nothing is stored, and nothing that identifies the visitor is sent", async ({ page, context }) => {
    // The browser already holds a cookie for PostHog's address (one it would send with a request from another site),
    // and the stub's answer tries to set another. A request that took part in cookies would show the first going out
    // and the second coming in.
    await context.addCookies([{ name: "seed", value: "1", url: ENDPOINT, sameSite: "None", secure: true }]);
    await loaded(page);
    await hit(page, 0);
    await setVisibility(page, "hidden");
    await expect.poll(() => sent.length).toBe(1);

    // Exactly these fields, so nothing else (an address, a screen size, a name) can slip in unnoticed.
    expect(Object.keys(sent[0].body).sort()).toEqual(["api_key", "distinct_id", "event", "properties"]);
    expect(Object.keys(sent[0].body.properties).sort()).toEqual(
      ["$geoip_disable", "$process_person_profile", "first_interaction_s", "play_s", "skin"].sort(),
    );
    expect(sent[0].body.properties.$process_person_profile).toBe(false);
    expect(sent[0].body.properties.$geoip_disable).toBe(true);
    expect(sent[0].body.distinct_id).toMatch(UUID);
    expect(sent[0].body.api_key).toMatch(/^phc_[A-Za-z0-9]+$/); // a project token, which can only send

    expect(sent[0].headers, "the cookie the browser holds for that address went out with the request").not.toHaveProperty("cookie");
    expect((await context.cookies()).map((c) => c.name), "the cookie the answer tried to set was stored").toEqual(["seed"]);
    expect(await page.evaluate(() => (window as any).__askedPostHog)).toEqual([{ credentials: "omit", keepalive: true }]);
    expect(
      await page.evaluate(() => ({ cookie: document.cookie, local: localStorage.length, session: sessionStorage.length })),
    ).toEqual({ cookie: "", local: 0, session: 0 });
  });
});

test.describe("an automated browser", () => {
  test("is not counted: nothing is sent, so the browser tests never add visits to the real data", async ({ page, context }) => {
    const sent = await catchVisits(context);
    await loaded(page);
    // The premise: a browser under test says so. If this ever stops being true, the checks below mean nothing.
    expect(await page.evaluate(() => navigator.webdriver)).toBe(true);
    await hit(page, 0);
    await setVisibility(page, "hidden");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.waitForTimeout(600);
    expect(sent).toHaveLength(0);
  });
});
