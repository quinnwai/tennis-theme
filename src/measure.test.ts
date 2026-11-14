import { describe, expect, it } from "vitest";
import { Measure, visitEvent, type VisitNumbers } from "./measure";

/** A measure that writes down what it reports. Times are milliseconds on the page's clock, which is 0 when the page begins to load. */
function setup(options?: { hidden?: boolean }) {
  const sent: VisitNumbers[] = [];
  return { m: new Measure((numbers) => sent.push(numbers), options), sent };
}

describe("the two numbers of a visit", () => {
  it("with no interaction: first-interaction time absent, play 0", () => {
    const { m, sent } = setup();
    m.end();
    // toStrictEqual, because a first_interaction_s that is present but undefined would still be a property.
    expect(sent).toStrictEqual([{ play_s: 0 }]);
  });

  it("with one interaction: first-interaction time is the seconds since the page began to load, play 0", () => {
    const { m, sent } = setup();
    m.interact(4300);
    m.end();
    expect(sent).toStrictEqual([{ first_interaction_s: 4.3, play_s: 0 }]);
  });

  it("with many interactions: play runs from the first to the last", () => {
    const { m, sent } = setup();
    for (const t of [2000, 2500, 9000, 31500]) m.interact(t);
    m.end();
    expect(sent).toStrictEqual([{ first_interaction_s: 2, play_s: 29.5 }]);
  });

  it("is rounded to a tenth of a second", () => {
    const { m, sent } = setup();
    m.interact(1234);
    m.interact(1234 + 2760);
    m.end();
    expect(sent).toStrictEqual([{ first_interaction_s: 1.2, play_s: 2.8 }]);
  });
});

describe("sending a visit", () => {
  it("happens once, however many times the page says it is being left", () => {
    const { m, sent } = setup();
    m.interact(1000);
    m.end(); // the tab is hidden
    m.end(); // and then the page is closed
    m.end();
    expect(sent).toHaveLength(1);
  });

  it("is not changed by anything that happens after the visit has ended", () => {
    const { m, sent } = setup();
    m.interact(1000);
    m.end();
    m.interact(5000);
    m.end();
    expect(sent).toStrictEqual([{ first_interaction_s: 1, play_s: 0 }]);
  });
});

describe("a tab that is hidden and comes back", () => {
  it("ends the visit when hidden; a new visit starts when it comes back, timed from the return", () => {
    const { m, sent } = setup();
    m.interact(3000);
    m.interact(8000);
    m.end(); // hidden at about 9 s
    m.begin(70_000); // back a minute later
    m.interact(71_500);
    m.interact(80_000);
    m.end();
    // The minute away is in neither visit: not in the first one's numbers, not in the second one's.
    expect(sent).toStrictEqual([
      { first_interaction_s: 3, play_s: 5 },
      { first_interaction_s: 1.5, play_s: 8.5 },
    ]);
  });

  it("does not report a return after which nothing happened", () => {
    const { m, sent } = setup();
    m.interact(3000);
    m.end();
    m.begin(10_000);
    m.end();
    expect(sent).toHaveLength(1);
  });

  it("carries on with a visit that is still going when told the tab is shown", () => {
    // pageshow fires on a normal load too, when the first visit is already under way.
    const { m, sent } = setup();
    m.interact(1000);
    m.begin(5000);
    m.interact(7000);
    m.end();
    expect(sent).toStrictEqual([{ first_interaction_s: 1, play_s: 6 }]);
  });

  it("times a page that opened in a background tab from the moment it is first shown", () => {
    const { m, sent } = setup({ hidden: true });
    m.begin(30_000);
    m.interact(32_000);
    m.end();
    expect(sent).toStrictEqual([{ first_interaction_s: 2, play_s: 0 }]);
  });

  it("reports nothing for a page that was never on screen", () => {
    const { m, sent } = setup({ hidden: true });
    m.end();
    expect(sent).toStrictEqual([]);
  });
});

describe("the event sent for a visit", () => {
  const id = "11111111-2222-4333-8444-555555555555";

  it("carries the skin, both numbers and the two settings that keep it anonymous, and nothing else", () => {
    const event = visitEvent(id, { first_interaction_s: 4.3, play_s: 21.7 });
    expect(Object.keys(event).sort()).toEqual(["api_key", "distinct_id", "event", "properties"]);
    expect(event.event).toBe("homepage_visit");
    expect(event.distinct_id).toBe(id);
    expect(event.properties).toStrictEqual({
      skin: "tennis",
      first_interaction_s: 4.3,
      play_s: 21.7,
      $process_person_profile: false,
      $geoip_disable: true,
    });
    // A project token can only send events. A personal API key (phx_) could read them and must never be here.
    expect(event.api_key).toMatch(/^phc_[A-Za-z0-9]+$/);
  });

  it("leaves the first-interaction time out when there was none", () => {
    const event = visitEvent(id, { play_s: 0 });
    expect(event.properties).not.toHaveProperty("first_interaction_s");
    expect(event.properties.play_s).toBe(0);
  });
});
