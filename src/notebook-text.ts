/**
 * What the notebook says: word for word what Quinn-Wai wrote, kept in this one place. The page that opens when the notebook is
 * clicked is made from it (see main.ts), and nothing else on the site says these words. Two paragraphs, a blank line between
 * them, and "[often]" in its brackets; do not tidy the wording or the apostrophes. It ships on the homepage, so it is meant to be public.
 */
export const NOTEBOOK_PARAGRAPHS = [
  "You found the secret message! As your reward, some brief context:",
  "I took inspo of the color scheme from the Aussie Open 2013 when I went, I was big into tennis as a kid! In my big tennis bag, which was nearly the same height as me, was always a notebook detailing important things like my breakthroughs from a practice session or reflecting on my strategy when I [often] lost my matches. My book-ish analytical ways in school couldn’t help but follow me to the tennis court as well! Enjoy playing around on my makeshift training grounds, and hit me up if you’d like to partner up for a game of doubles together!",
];

/** The same, as one text: the paragraphs with a blank line between them. */
export const NOTEBOOK_TEXT = NOTEBOOK_PARAGRAPHS.join("\n\n");
