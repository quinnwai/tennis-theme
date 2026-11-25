import "./rules-card.css";

/** The game in four short steps. No numbers for the distance: "from a distance" is enough to get the idea. */
const STEPS = ["Tap a can to pour", "Drag a ball to throw", "Sink it from a distance", "Win 3 points, win the match"];

export interface RulesCard {
  /** Shown with the scoreboard, closed: only its tab pokes out under the board. */
  show(): void;
  /** Out of the way (after the win, the match stats drop down there instead). */
  hide(): void;
  close(): void;
  readonly open: boolean;
}

/**
 * how to play, on an umpire's card tucked behind the scoreboard (Quinn-Wai's pick of three concepts).
 * Only its tab pokes out under the board, the way the notebook pokes out of the bag; a tap on it slides the card down
 * with the four steps, and another tap slides it back. It comes and goes with the board, so it never announces the game.
 */
export function mountRulesCard(score: HTMLElement): RulesCard {
  document.body.classList.add("v7");
  const wrap = document.createElement("div");
  wrap.className = "v7-rules";
  wrap.hidden = true;
  const id = "v7-rules-steps";
  const chevron = `<svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1L5 5L9 1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  wrap.innerHTML =
    `<div class="v7-rules-card"><div class="v7-rules-paper"><ol id="${id}">` +
    STEPS.map((s, i) => `<li><span class="n">${i + 1}</span><span class="t">${s}</span></li>`).join("") +
    `</ol></div><button type="button" class="v7-rules-tab" aria-expanded="false" aria-controls="${id}">How to play ${chevron}</button></div>`;
  const board = score.querySelector(".v6-score-board");
  if (board) board.after(wrap);
  else score.prepend(wrap);
  const card = wrap.querySelector<HTMLElement>(".v7-rules-card")!;
  const tab = wrap.querySelector<HTMLButtonElement>(".v7-rules-tab")!;

  let open = false;
  /** The clip around the card is as tall as the open card, so it can slide all the way out. */
  const fit = () => wrap.style.setProperty("--card-h", `${card.offsetHeight}px`);
  const set = (to: boolean) => {
    open = to;
    wrap.classList.toggle("open", to);
    tab.setAttribute("aria-expanded", String(to));
  };
  tab.addEventListener("click", () => set(!open));
  // a press anywhere on the open card folds it away again
  card.addEventListener("click", (e) => {
    if (open && e.target !== tab && !tab.contains(e.target as Node)) set(false);
  });
  window.addEventListener("resize", fit);
  if (document.fonts) void document.fonts.ready.then(fit);

  return {
    show() {
      set(false);
      wrap.hidden = false;
      fit();
    },
    hide() {
      set(false);
      wrap.hidden = true;
    },
    close() {
      set(false);
    },
    get open() {
      return open;
    },
  };
}
