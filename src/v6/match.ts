/**
 * The match the cans game plays out. A five-setter against Nadal at two sets all: you lead 5-4 in the fifth and serve for it at
 * 15-30. Every counted throw wins you a point: 30-30, then 40-30 (championship point). Nadal never scores. Three points win the match: 30-30, 40-30
 * (championship point), then game, set and match.
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

  get won(): boolean {
    return this.you >= 4;
  }

  /** The points you have won since the game was found. */
  get pointsWon(): number {
    return this.you - START;
  }

  /** At 40-30: one point from the match. */
  get championshipPoint(): boolean {
    return this.you === 3;
  }

  /** How the umpire calls a player's points: 0, 15, 30, 40. */
  call(points: number): string {
    return CALLS[points] ?? "";
  }

  /** You win a point. Says what it made of the match ("over": it was already won). */
  point(): "point" | "championship point" | "won" | "over" {
    if (this.won) return "over";
    this.you += 1;
    if (this.won) {
      this.sets.you[4] = 6;
      return "won";
    }
    return this.championshipPoint ? "championship point" : "point";
  }

  /** A new match at 15-30, the game still found. */
  playAgain(): void {
    this.you = START;
    this.sets.you[4] = 5;
  }

  reset(): void {
    this.found = false;
    this.playAgain();
  }
}
