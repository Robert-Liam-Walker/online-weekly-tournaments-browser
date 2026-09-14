// The standard competitive Melee singles ruleset, as data and pure functions.
// Source of the wording: the current recommended ruleset on SmashWiki
// (Tournament rulesets (SSBM), 1-on-1 section). Everything the platform
// enforces reads from here; the Rules page renders from here too.

export const STOCKS = 4;
export const TIME_MINUTES = 8;
export const ITEMS_ON = false;
export const PAUSE_ON = false;
/** Timed-out game with equal stocks and equal percent: replay the last stock, same stage, 2 minutes. */
export const TIEBREAK_REPLAY_MINUTES = 2;
export const TIEBREAK_REPLAY_STOCKS = 1;
/** Ledge-grab limit: over 40 cliffhangers on a time-out forfeits the game; 50 otherwise. */
export const LGL_TIMEOUT = 40;
export const LGL_ALWAYS = 50;

export type StageId = "battlefield" | "dreamland" | "fd" | "fod" | "yoshis" | "stadium";

export interface Stage {
  id: StageId;
  name: string;
  /** Melee internal stage id (for the wasm engine). */
  meleeId: number;
}

export const NEUTRAL_STAGES: readonly Stage[] = [
  { id: "battlefield", name: "Battlefield", meleeId: 0x1f },
  { id: "dreamland", name: "Dream Land N64", meleeId: 0x1c },
  { id: "fd", name: "Final Destination", meleeId: 0x20 },
  { id: "fod", name: "Fountain of Dreams", meleeId: 0x02 },
  { id: "yoshis", name: "Yoshi's Story", meleeId: 0x08 },
];

export const COUNTERPICK_STAGES: readonly Stage[] = [
  { id: "stadium", name: "Pokémon Stadium", meleeId: 0x03 },
];

export const LEGAL_STAGES: readonly Stage[] = [...NEUTRAL_STAGES, ...COUNTERPICK_STAGES];

export function stageById(id: string): Stage | undefined {
  return LEGAL_STAGES.find((s) => s.id === id);
}

/**
 * Game 1 striking from the five neutrals: the first striker removes one, the
 * second removes two, the first striker removes one more; the last stage
 * standing is played. Each entry is [who strikes (0 = first striker), how many].
 */
export const STRIKE_ORDER: readonly (readonly [striker: 0 | 1, count: number])[] = [[0, 1], [1, 2], [0, 1]];

export type SetFormat = "BO3" | "BO5";
export const WINS_NEEDED: Record<SetFormat, number> = { BO3: 2, BO5: 3 };

/** Bo5 for winners final, losers final, grand final and the reset; Bo3 elsewhere. */
export function formatForMatch(side: "W" | "L" | "GF" | "GFR", round: number, bracketSize: number): SetFormat {
  const k = Math.log2(bracketSize);
  if (side === "GF" || side === "GFR") return "BO5";
  if (side === "W" && round === k) return "BO5";
  if (side === "L" && round === 2 * k - 2) return "BO5";
  return "BO3";
}

/** The winner may ban one stage from the opponent's selection, except in best-of-5 sets. */
export function winnerBanCount(format: SetFormat): number {
  return format === "BO3" ? 1 : 0;
}

/** Dave's Stupid Rule: the loser cannot choose any stage they have already won on in the current set. */
export function counterpickAllowed(stage: StageId, loserWonOn: readonly StageId[], banned: readonly StageId[]): boolean {
  return !loserWonOn.includes(stage) && !banned.includes(stage);
}

/** Time-out tie-breaker: more stocks wins; equal stocks, less damage wins; equal both, replay the last stock. */
export function timeoutWinner(p: readonly { stocks: number; percent: number }[]): 0 | 1 | null {
  const a = p[0]!, b = p[1]!;
  if (a.stocks !== b.stocks) return a.stocks > b.stocks ? 0 : 1;
  if (a.percent !== b.percent) return a.percent < b.percent ? 0 : 1;
  return null;
}

/** A registered player who is not in the arena this long after their match is ready forfeits it. */
export const NO_SHOW_FORFEIT_MINUTES = 5;
/** A player who disconnects mid-set and stays away this long forfeits the set. */
export const DISCONNECT_FORFEIT_MINUTES = 3;
/** A connected player who sits on a strike, pick or ready-up this long forfeits the set. */
export const SETUP_ACTION_MINUTES = 2;
/** Lobby opens this many minutes before the scheduled start. */
export const LOBBY_OPEN_MINUTES = 15;
/** Seconds between "both players ready" and the first frame. */
export const START_COUNTDOWN_SECONDS = 5;
/** Minimum entrants present for the bracket to run. */
export const MIN_ENTRANTS = 2;
/** Simulation and snapshot rates. */
export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 20;

/**
 * Season points for a final placement. 1st is 100, and points fall off with the
 * fraction of the field a player outlasted (ties share the tier). Always >= 1.
 */
export function placementPoints(place: number, entrants: number): number {
  if (place < 1 || entrants < 1 || place > entrants) return 0;
  if (place === 1) return 100;
  const outlasted = (entrants - place) / Math.max(1, entrants - 1);
  return Math.max(1, Math.round(60 * outlasted * outlasted + 10 * outlasted));
}
