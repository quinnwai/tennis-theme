// The words in the notebook are Quinn-Wai's, final, and ship on the homepage. This pins them, with a copy of its own that only a
// deliberate change to the words and to this file together can match, and checks that they live in one place.

import { describe, expect, it } from "vitest";
import { NOTEBOOK_PARAGRAPHS, NOTEBOOK_TEXT } from "./notebook-text";

/** The notebook text as given on the ticket (QWW-85), including its curly apostrophes (U+2019) and the blank line after the first line. */
const GIVEN =
  "You found the secret message! As your reward, some brief context:\n" +
  "\n" +
  "I took inspo of the color scheme from the Aussie Open 2013 when I went, I was big into tennis as a kid! In my big tennis bag, which was nearly the same height as me, was always a notebook detailing important things like my breakthroughs from a practice session or reflecting on my strategy when I [often] lost my matches. My book-ish analytical ways in school couldn’t help but follow me to the tennis court as well! Enjoy playing around on my makeshift training grounds, and hit me up if you’d like to partner up for a game of doubles together!";

describe("the notebook's text", () => {
  it("is word for word what Quinn-Wai wrote", () => {
    expect(NOTEBOOK_TEXT).toBe(GIVEN);
  });

  it("is two paragraphs: the first line, then a blank line, then the rest", () => {
    expect(NOTEBOOK_PARAGRAPHS).toHaveLength(2);
    expect(NOTEBOOK_PARAGRAPHS[0]).toBe("You found the secret message! As your reward, some brief context:");
    expect(NOTEBOOK_TEXT.split("\n")).toHaveLength(3);
    expect(NOTEBOOK_TEXT.split("\n")[1]).toBe("");
  });

  it('keeps "[often]" in its brackets, and the curly apostrophes as they were written', () => {
    expect(NOTEBOOK_TEXT).toContain("when I [often] lost my matches");
    expect(NOTEBOOK_TEXT).toContain("couldn’t");
    expect(NOTEBOOK_TEXT).toContain("you’d");
    expect(NOTEBOOK_TEXT).not.toContain("'");
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
    for (const phrase of ["You found the secret message", "makeshift training grounds", "partner up for a game of doubles"]) {
      const files = shipped.filter(([, text]) => text.includes(phrase)).map(([file]) => file);
      expect(files, phrase).toEqual(["./notebook-text.ts"]);
    }
  });

  it("is read by the page: main.ts imports it", () => {
    const main = shipped.find(([file]) => file === "./main.ts")![1];
    expect(main).toMatch(/from "\.\/notebook-text"/);
  });
});
