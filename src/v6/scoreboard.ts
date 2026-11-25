/**
 * The cans game's scoreboard, top left, in the design round's look B (the site's own: the page's navy a step darker, white names,
 * ball-green set scores, court blue for the edge and the game). It slides in once a can has been emptied.
 */
import "./scoreboard.css";
import ballUrl from "../../design/v7/assets/ball7.svg?url";
import type { Match } from "./match";

export type Scoreboard = ReturnType<typeof mountScoreboard>;

export function mountScoreboard() {
  const el = document.createElement("section");
  el.className = "v6-score";
  el.setAttribute("aria-label", "Scoreboard");
  el.hidden = true;
  const board = document.createElement("div");
  board.className = "v6-score-board";
  board.setAttribute("aria-live", "polite");
  el.append(board);
  document.body.append(el);

  function render(match: Match, flash: boolean): void {
    const row = (who: "you" | "them") => {
      const mine = match.sets[who];
      const theirs = match.sets[who === "you" ? "them" : "you"];
      let r = `<tr class="${who}">`;
      if (who === "you") r += `<td class="edge" rowspan="2"></td>`;
      r += `<th scope="row">${who === "you" ? "YOU" : "NADAL"}</th>`;
      r += `<td class="serve">${who === "you" ? `<img src="${ballUrl}" alt="serving">` : ""}</td>`;
      mine.forEach((games, i) => {
        const live = i === mine.length - 1;
        r += `<td class="set${live ? " live" : ""}${live || games > theirs[i] ? " took" : ""}">${games}</td>`;
      });
      r += `<td class="game${flash && who === "you" ? " flash" : ""}">${match.call(who === "you" ? match.you : match.them)}</td>`;
      return r + "</tr>";
    };
    const bar = match.championshipPoint ? `<p class="bar cp">CHAMPIONSHIP POINT</p>` : "";
    board.innerHTML = `<table aria-label="Scoreboard: you against Nadal, fifth set"><tbody>${row("you")}${row("them")}</tbody></table>${bar}`;
  }

  return {
    show(match: Match): void {
      render(match, false);
      el.hidden = false;
    },
    hide(): void {
      el.hidden = true;
    },
    /** Show the score as it is now; `flash` lights up your points, just won. */
    update(match: Match, flash: boolean): void {
      render(match, flash);
    },
  };
}
