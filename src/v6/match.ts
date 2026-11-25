/**
 * The match the cans game plays out. A five-setter against Nadal at two sets all: you lead 5-4 in the fifth and serve for it at
 * 15-30. Every counted throw wins you a point: 30-30, then 40-30 (championship point). Nadal never scores. Winning the match is
 * the next step of QWW-99, so for now the score stops at 40-30.
 */
const CALLS = ["0", "15", "30", "40"];
/** Your points when the game is found: 15. */
const START = 1;

export class Match {
  /** Whether the visitor has found the game, by emptying a can. */
  found = false;
  /** Your points in this game, as an index into the calls. */
  you = START;
  readonly them = 2;
  readonly sets = { you: [6, 3, 7, 4, 5], them: [4, 6, 6, 6, 4] };

  /** At 40-30: one point from the match. */
  get championshipPoint(): boolean {
    return this.you === 3;
  }

  /** How the umpire calls a player's points: 0, 15, 30, 40. */
  call(points: number): string {
    return CALLS[points] ?? "";
  }

  /** You win a point. Says what it made of the match ("over": already at championship point, where it stops for now). */
  point(): "point" | "championship point" | "over" {
    if (this.championshipPoint) return "over";
    this.you += 1;
    return this.championshipPoint ? "championship point" : "point";
  }

  reset(): void {
    this.found = false;
    this.you = START;
  }
}
