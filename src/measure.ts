// Two numbers for every visit, sent once to PostHog (US cloud) so each visit can be read back on its own:
//   first_interaction_s  seconds from the start of the visit to the first hit or pick-up (left out if there was none)
//   play_s               seconds from the first interaction to the last (0 for none or one)
// No cookies and no browser storage, and nothing that says who the visitor is. The only id is a random one made
// up for the visit and never kept. Every skin of the homepage sends the same event, told apart by `skin`.

const SKIN = "tennis";
const EVENT = "homepage_visit";
const ENDPOINT = "https://us.i.posthog.com/i/v0/e/";
// A PostHog project token can only send events, never read them back, so it is safe to keep in public source.
const PROJECT_TOKEN = "phc_kf65rX5Qc3S5mj9oAjy2sAXEXGfXri8mpa6yMtYG2VUM";

export interface VisitNumbers {
  /** Seconds until the first hit or pick-up. Left out when the visitor never touched a ball. */
  first_interaction_s?: number;
  /** Seconds from the first interaction to the last. */
  play_s: number;
}

/** One stretch of the page being on screen. Times are milliseconds on the page's clock. */
interface Stretch {
  start: number;
  first: number | null;
  last: number;
}

const tenthsOfASecond = (ms: number): number => Math.round(ms / 100) / 10;

/**
 * Times visits. A visit is one stretch of the page being on screen: it starts when the page loads (or when a
 * hidden tab comes back) and ends when the tab is hidden or the page is left. Time spent away belongs to no
 * visit, and each visit is reported once, the moment it ends. The page's clock starts at 0 when it begins to
 * load, which is where the first visit starts, so a slow load counts against the first number as it does for
 * the visitor.
 */
export class Measure {
  private stretch: Stretch | null = null;
  /** Whether this page load has reported a visit yet. */
  private reported = false;

  /** `hidden`: the page opened in a background tab, so its first visit starts when the tab is first shown. */
  constructor(
    private report: (numbers: VisitNumbers) => void,
    { hidden = false }: { hidden?: boolean } = {},
  ) {
    if (!hidden) this.begin(0);
  }

  /** The visitor hit a ball, picked one up, moved one they were carrying, or let it go. */
  interact(now: number): void {
    const s = this.stretch;
    if (!s) return;
    s.first ??= now;
    s.last = now;
  }

  /** The tab came back, or the page was shown again from the back button. A visit that is still going carries on. */
  begin(now: number): void {
    this.stretch ??= { start: now, first: null, last: now };
  }

  /**
   * The tab was hidden or the page was left. Ending twice is harmless, which is how a visit is reported once
   * however many signals say it is over. The first visit of a page load is reported even if nothing happened
   * in it, because that is a visitor who never touched a ball. A later one is not, because it is only the
   * same visitor glancing back.
   */
  end(): void {
    const s = this.stretch;
    this.stretch = null;
    if (!s || (s.first === null && this.reported)) return;
    this.reported = true;
    this.report(
      s.first === null
        ? { play_s: 0 }
        : { first_interaction_s: tenthsOfASecond(s.first - s.start), play_s: tenthsOfASecond(s.last - s.first) },
    );
  }
}

/** What goes to PostHog for one visit: its two numbers, the skin, and the settings that keep it anonymous. */
export function visitEvent(id: string, numbers: VisitNumbers) {
  return {
    api_key: PROJECT_TOKEN,
    event: EVENT,
    distinct_id: id,
    properties: {
      skin: SKIN,
      ...numbers,
      $process_person_profile: false, // no person is made for the id
      $geoip_disable: true, // no place is looked up from the address
    },
  };
}

/**
 * A plain-text body is a simple request, so there is no preflight to wait for while the page is closing.
 * `keepalive` lets it finish after the page is gone. `credentials: "omit"` is the point of using fetch over
 * sendBeacon here: a beacon always carries cookies and can store them, this cannot.
 */
function deliver(event: ReturnType<typeof visitEvent>): void {
  fetch(ENDPOINT, { method: "POST", body: JSON.stringify(event), keepalive: true, credentials: "omit" }).catch(() => {
    // Blocked by the visitor's browser or offline: a lost visit is not worth a message in their console.
  });
}

/**
 * Starts measuring and returns the function to call whenever the visitor hits, picks up, carries or lets go
 * of a ball. Measures nothing, and returns a function that does nothing, in an automated browser (tests must
 * not add visits to the real data) and where the browser has no randomUUID (any address that is not https
 * or localhost, such as a phone reaching the dev server over wifi).
 */
export function startMeasuring(): () => void {
  if (navigator.webdriver || typeof crypto.randomUUID !== "function") return () => {};
  const measure = new Measure((numbers) => deliver(visitEvent(crypto.randomUUID(), numbers)), {
    hidden: document.visibilityState === "hidden",
  });
  // visibilitychange is the last signal a phone is sure to send; pagehide covers closing the page or going to
  // another one, and is the only signal some browsers give. A page can start again from the back button
  // without a visibilitychange, so pageshow listens for that too.
  const sync = () => (document.visibilityState === "hidden" ? measure.end() : measure.begin(performance.now()));
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pageshow", sync);
  window.addEventListener("pagehide", () => measure.end());
  return () => measure.interact(performance.now());
}
