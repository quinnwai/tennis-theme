// The words in the notebook are Quinn-Wai's, final, and ship on the homepage. This pins them, with a copy of its own that only a
// deliberate change to the words and to this file together can match, and checks that they live in one place.

import { describe, expect, it } from "vitest";
import { NOTEBOOK_BODY, notebookText } from "./notebook-text";

/** The notebook's words as given on the ticket (QWW-85, round 3): five paragraphs, with a blank line between them. */
const GIVEN = [
  "Tennis has always been a big part of my life: the endless inside-out forehand drills, the challenging mental battle of matches, and the awesome friends I've made through that time. So I wanted to honor that.",
  "The color scheme is largely inspired from the 2014 Aussie Open. In that era of my life, I would always insist on carrying a big tennis bag like the one I designed, which was nearly my height at the time.",
  "As high school started, I switched from being a Babolat kid to a Wilson one. In my tennis bag was always a notebook where I'd write my notes from a practice session or reflect on my tournament tactics. My detail-oriented analytical mind couldn’t help but light up in my sports pursuits as well.",
  "My competitive journey peaked in college playing club tennis and roadtripping across the country. It was right around the time I started my journey as a software engineer too.",
  "Enjoy the training grounds I made and contact me if you ever want to hit the courts together!",
].join("\n\n");

describe("the notebook's text", () => {
  it("is word for word what Quinn-Wai wrote", () => {
    expect(NOTEBOOK_BODY).toBe(GIVEN);
  });

  it("is five paragraphs with a blank line between them, and the old words are gone", () => {
    expect(NOTEBOOK_BODY.split("\n\n")).toHaveLength(5);
    expect(NOTEBOOK_BODY).not.toContain("[often]");
    expect(NOTEBOOK_BODY).not.toContain("You found the secret message");
  });

  it("keeps the curly apostrophe where it was written", () => {
    expect(NOTEBOOK_BODY).toContain("couldn’t");
    expect(NOTEBOOK_BODY.match(/’/g)).toHaveLength(1); // the others are straight, as typed
    expect(NOTEBOOK_BODY).toContain("I've made");
  });

  it("starts with the date it is read on, in long US form, and a blank line, then the words", () => {
    expect(notebookText(new Date(2026, 10, 20))).toBe(`November 20, 2026\n\n${GIVEN}`);
    expect(notebookText(new Date(2027, 0, 5)).split("\n")[0]).toBe("January 5, 2027");
    expect(notebookText(new Date(2027, 0, 5)).split("\n")[1]).toBe("");
  });

  it("is dated on each reading: today's date when no day is given", () => {
    const first = notebookText().split("\n")[0];
    expect(first).toBe(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
  });
});

describe("where the notebook's text lives", () => {
  // Every file the site is built from, as text: the scripts and the stylesheet under src/ (not the tests), and the page.
  const sources = {
    ...import.meta.glob("./**/*.{ts,css}", { query: "?raw", import: "default", eager: true }),
    ...import.meta.glob("../index.html", { query: "?raw", import: "default", eager: true }),
  } as Record<string, string>;
  const shipped = Object.entries(sources).filter(([file]) => !file.endsWith(".test.ts"));

  it("is in one file only, which the page's script reads it from", () => {
    expect(shipped.length).toBeGreaterThan(10); // the glob found the site's files
    for (const phrase of ["endless inside-out forehand drills", "Enjoy the training grounds I made", "roadtripping across the country"]) {
      const files = shipped.filter(([, text]) => text.includes(phrase)).map(([file]) => file);
      expect(files, phrase).toEqual(["./notebook-text.ts"]);
    }
  });

  it("is read by the page: the notebook script imports it", () => {
    const main = shipped.find(([file]) => file === "./v6/notebook.ts")![1];
    expect(main).toMatch(/from "\.\.\/notebook-text"/);
  });
});
