/**
 * The notebook's words: Quinn-Wai's fixed text of 2026-11-20, word for word, under the date the visitor reads them.
 * Keep the blank lines between paragraphs. It is public: it ships on the homepage.
 */
export const NOTEBOOK_BODY = "Tennis has always been a big part of my life: the endless inside-out forehand drills, the challenging mental battle of matches, and the awesome friends I've made through that time. So I wanted to honor that.\n\nThe color scheme is largely inspired from the 2014 Aussie Open. In that era of my life, I would always insist on carrying a big tennis bag like the one I designed, which was nearly my height at the time.\n\nAs high school started, I switched from being a Babolat kid to a Wilson one. In my tennis bag was always a notebook where I'd write my notes from a practice session or reflect on my tournament tactics. My detail-oriented analytical mind couldn’t help but light up in my sports pursuits as well.\n\nMy competitive journey peaked in college playing club tennis and roadtripping across the country. It was right around the time I started my journey as a software engineer too.\n\nEnjoy the training grounds I made and contact me if you ever want to hit the courts together!";

/** The words as the notebook shows them on `day` (the visitor's today): its date, as "November 20, 2026", a blank line, then the body. */
export function notebookText(day: Date = new Date()): string {
  const date = day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `${date}\n\n${NOTEBOOK_BODY}`;
}
