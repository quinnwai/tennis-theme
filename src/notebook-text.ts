/**
 * The notebook's words: Quinn-Wai's fixed text of 2026-11-20, word for word, under the date the visitor reads them.
 * Keep the blank lines between paragraphs. It is public: it ships on the homepage.
 */
export const NOTEBOOK_BODY = "Tennis has always been a big part of my life: the endless inside out forehand drills, the challenging mental battle from matches, and the awesome friends I've met through that time. So I wanted to honor that time of my life\n\nThe color scheme is largely inspired from Aussie Open in 2014, I saw Djoko warming up and got a towel just like this one as souvenir! During that time, I would always insist on carrying a big tennis bag like the one here, which was nearly my height at the time.\n\nAs high school started, I switched from being a Babolat kid  to a Wilson one, and started using the Wilson Blade (green design not pictured in frame). In my tennis bag was always a notebook where I'd write my notes from a practice session or reflect on my tournament tactics. My book-ish analytical mind couldn’t help but light up in my sports pursuits as well.\n\nMy competitive journey peaked in college playing club tennis and roadtripping around the country, and it was right around the time I started my journey as a software engineer too!\n\nEnjoy playing around on my makeshift training grounds and   hit me up if you wanna hit the courts together!";

/** The words as the notebook shows them on `day` (the visitor's today): its date, as "November 20, 2026", a blank line, then the body. */
export function notebookText(day: Date = new Date()): string {
  const date = day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `${date}\n\n${NOTEBOOK_BODY}`;
}
