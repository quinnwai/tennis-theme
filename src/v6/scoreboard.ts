/**
 * The cans game's scoreboard, top left, in the design round's look B (the site's own: the page's navy a step darker, white names,
 * ball-green set scores, court blue for the edge and the game). It slides in once a can has been emptied.
 */
import "./scoreboard.css";
import ballUrl from "../../design/v7/assets/ball7.svg?url";
import type { Match } from "./match";

/** How the match went, for the stats card. `ms`: time on court, from finding the game to winning it. */
export interface MatchStats {
  thrown: number;
  inCans: number;
  points: number;
  streak: number;
  ms: number;
}

export type Scoreboard = ReturnType<typeof mountScoreboard>;

/** Time on court as minutes and seconds: 0m14s, 1m05s, 10m00s. */
export function courtTime(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

export function mountScoreboard() {
  const el = document.createElement("section");
  el.className = "v6-score";
  el.setAttribute("aria-label", "Scoreboard");
  el.hidden = true;
  const board = document.createElement("div");
  board.className = "v6-score-board";
  board.setAttribute("aria-live", "polite");
  const stats = document.createElement("div");
  stats.className = "v6-score-stats";
  stats.setAttribute("data-match-stats", "");
  stats.hidden = true;
  el.append(board, stats);
  document.body.append(el);

  function render(match: Match, flash: boolean): void {
    const won = match.won;
    const row = (who: "you" | "them") => {
      const mine = match.sets[who];
      const theirs = match.sets[who === "you" ? "them" : "you"];
      let r = `<tr class="${who}">`;
      if (who === "you") r += `<td class="edge" rowspan="2"></td>`;
      r += `<th scope="row">${who === "you" ? "YOU" : "NADAL"}</th>`;
      r += `<td class="serve">${who === "you" && !won ? `<img src="${ballUrl}" alt="serving">` : ""}</td>`;
      mine.forEach((games, i) => {
        const live = i === mine.length - 1 && !won;
        r += `<td class="set${live ? " live" : ""}${live || games > theirs[i] ? " took" : ""}">${games}</td>`;
      });
      if (won) r += `<td class="game"></td>`;
      else r += `<td class="game${flash && who === "you" ? " flash" : ""}">${match.call(who === "you" ? match.you : match.them)}</td>`;
      return r + "</tr>";
    };
    const bar = won ? `<p class="bar won">GAME, SET, MATCH</p>` : match.championshipPoint ? `<p class="bar cp">CHAMPIONSHIP POINT</p>` : "";
    board.innerHTML = `<table aria-label="Scoreboard: you against Nadal, fifth set"><tbody>${row("you")}${row("them")}</tbody></table>${bar}`;
  }

  return {
    show(match: Match): void {
      render(match, false);
      stats.hidden = true;
      el.hidden = false;
    },
    hide(): void {
      el.hidden = true;
      stats.hidden = true;
    },
    /** Show the score as it is now; `flash` lights up your points, just won. */
    update(match: Match, flash: boolean): void {
      render(match, flash);
    },
    /** The match stats card, dropping down under the board, with a button to start a new match. */
    showStats(s: MatchStats, playAgain: () => void): void {
      const accuracy = s.thrown > 0 ? Math.round((100 * s.points) / s.thrown) : 0;
      const time = courtTime(s.ms);
      const pair = (k: string, v: string | number) => `<dt>${k}</dt><dd>${v}</dd>`;
      // in full, and, for windows too short for the card (a phone held sideways), on one line under the board
      stats.innerHTML =
        `<p class="head">MATCH STATS</p><dl>${pair("Balls thrown", s.thrown)}${pair("Into the cans", s.inCans)}` +
        `${pair("Accuracy", `${accuracy}%`)}${pair("Points in a row", s.streak)}${pair("Time on court", time)}</dl>` +
        `<p class="line">${s.thrown} thrown <span>·</span> ${accuracy}% <span>·</span> ${time} on court</p>`;
      const again = document.createElement("button");
      again.type = "button";
      again.className = "again";
      again.textContent = "Play again";
      again.addEventListener("click", playAgain);
      stats.append(again);
      stats.hidden = false;
    },
  };
}
