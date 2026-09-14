// A best-of-N set as a pure state machine. The match room applies player
// actions through `applyAction` and feeds game results through `recordGame`;
// nothing here touches IO, so the whole procedure is unit-tested.
//
// Game 1: striking (first striker removes 1, other removes 2, first removes 1),
// then double-blind character picks. Later games: winner bans (Bo3 only), loser
// picks a stage they have not won on (DSR), winner picks character, loser picks
// character. Then both ready up and the game runs.

import { COUNTERPICK_STAGES, NEUTRAL_STAGES, STRIKE_ORDER, WINS_NEEDED, counterpickAllowed, winnerBanCount, type SetFormat, type StageId } from "./rules.js";
import { characterById } from "./characters.js";

export type SetPhase = "striking" | "blind_pick" | "ban" | "counterpick" | "winner_char" | "loser_char" | "ready" | "playing" | "complete";

export interface GameRecord {
  stage: StageId;
  chars: [string, string];
  winner: 0 | 1;
  /** true when this game was a 1-stock tie-break replay of a timed-out game */
  tiebreak?: boolean;
}

export interface SetState {
  format: SetFormat;
  players: [string, string];        // user ids by slot
  phase: SetPhase;
  gameNumber: number;               // 1-based, the game being set up or played
  games: GameRecord[];
  score: [number, number];
  /** striking */
  firstStriker: 0 | 1;
  strikeStep: number;               // index into STRIKE_ORDER
  struck: StageId[];
  /** picks for the upcoming game */
  stage: StageId | null;
  chars: [string | null, string | null];
  blindSubmitted: [boolean, boolean];
  banned: StageId[];                // this game's winner bans
  ready: [boolean, boolean];
  /** whether the next game is a 1-stock tie-break replay */
  tiebreakPending: boolean;
  winner: 0 | 1 | null;
}

export type SetAction =
  | { type: "strike"; stages: StageId[] }
  | { type: "blind_pick"; char: string }
  | { type: "ban"; stages: StageId[] }
  | { type: "pick_stage"; stage: StageId }
  | { type: "pick_char"; char: string }
  | { type: "ready" };

export class SetError extends Error {}

export function createSet(players: [string, string], format: SetFormat, firstStriker: 0 | 1): SetState {
  return {
    format, players, phase: "striking", gameNumber: 1, games: [], score: [0, 0],
    firstStriker, strikeStep: 0, struck: [], stage: null, chars: [null, null], blindSubmitted: [false, false],
    banned: [], ready: [false, false], tiebreakPending: false, winner: null,
  };
}

/** Whose turn it is for the current phase, or null when both act (blind pick, ready). */
export function turnOf(s: SetState): 0 | 1 | null {
  switch (s.phase) {
    case "striking": {
      const step = STRIKE_ORDER[s.strikeStep];
      if (!step) return null;
      return step[0] === 0 ? s.firstStriker : ((1 - s.firstStriker) as 0 | 1);
    }
    case "ban": return lastWinner(s);
    case "counterpick": return lastLoser(s);
    case "winner_char": return lastWinner(s);
    case "loser_char": return lastLoser(s);
    default: return null;
  }
}

export function lastWinner(s: SetState): 0 | 1 { return s.games[s.games.length - 1]!.winner; }
export function lastLoser(s: SetState): 0 | 1 { return (1 - lastWinner(s)) as 0 | 1; }

export function stagesWonOn(s: SetState, slot: 0 | 1): StageId[] {
  return s.games.filter((g) => g.winner === slot).map((g) => g.stage);
}

export function remainingNeutrals(s: SetState): StageId[] {
  return NEUTRAL_STAGES.map((st) => st.id).filter((id) => !s.struck.includes(id));
}

/** Stages the loser may counterpick right now (DSR + this game's bans). */
export function counterpickOptions(s: SetState): StageId[] {
  const loser = lastLoser(s);
  return [...NEUTRAL_STAGES, ...COUNTERPICK_STAGES].map((st) => st.id).filter((id) => counterpickAllowed(id, stagesWonOn(s, loser), s.banned));
}

function clone(s: SetState): SetState {
  return { ...s, games: [...s.games], score: [...s.score] as [number, number], struck: [...s.struck], chars: [...s.chars] as [string | null, string | null], blindSubmitted: [...s.blindSubmitted] as [boolean, boolean], banned: [...s.banned], ready: [...s.ready] as [boolean, boolean] };
}

function requireChar(id: string): string {
  if (!characterById(id)) throw new SetError("Unknown character");
  return id;
}

export function applyAction(state: SetState, slot: 0 | 1, action: SetAction): SetState {
  const s = clone(state);
  const turn = turnOf(s);
  switch (action.type) {
    case "strike": {
      if (s.phase !== "striking") throw new SetError("Not striking");
      if (turn !== slot) throw new SetError("Not your strike");
      const step = STRIKE_ORDER[s.strikeStep]!;
      const remaining = remainingNeutrals(s);
      if (action.stages.length !== step[1]) throw new SetError(`Strike exactly ${step[1]}`);
      if (new Set(action.stages).size !== action.stages.length || action.stages.some((x) => !remaining.includes(x))) throw new SetError("Stage not available to strike");
      s.struck.push(...action.stages);
      s.strikeStep++;
      if (s.strikeStep >= STRIKE_ORDER.length) {
        const left = remainingNeutrals(s);
        if (left.length !== 1) throw new SetError("Striking did not leave one stage");
        s.stage = left[0]!;
        s.phase = "blind_pick";
      }
      return s;
    }
    case "blind_pick": {
      if (s.phase !== "blind_pick") throw new SetError("Not picking blind");
      if (s.blindSubmitted[slot]) throw new SetError("Already picked");
      s.chars[slot] = requireChar(action.char);
      s.blindSubmitted[slot] = true;
      if (s.blindSubmitted[0] && s.blindSubmitted[1]) s.phase = "ready";
      return s;
    }
    case "ban": {
      if (s.phase !== "ban") throw new SetError("Not banning");
      if (turn !== slot) throw new SetError("Only the winner bans");
      const n = winnerBanCount(s.format);
      if (action.stages.length !== n) throw new SetError(`Ban exactly ${n}`);
      const legal = [...NEUTRAL_STAGES, ...COUNTERPICK_STAGES].map((x) => x.id);
      if (action.stages.some((x) => !legal.includes(x))) throw new SetError("Not a legal stage");
      s.banned = [...action.stages];
      s.phase = "counterpick";
      return s;
    }
    case "pick_stage": {
      if (s.phase !== "counterpick") throw new SetError("Not counterpicking");
      if (turn !== slot) throw new SetError("Only the loser picks the stage");
      if (!counterpickOptions(s).includes(action.stage)) throw new SetError("That stage is not available (banned or DSR)");
      s.stage = action.stage;
      s.phase = "winner_char";
      return s;
    }
    case "pick_char": {
      if (s.phase !== "winner_char" && s.phase !== "loser_char") throw new SetError("Not picking characters");
      if (turn !== slot) throw new SetError("Not your pick");
      s.chars[slot] = requireChar(action.char);
      s.phase = s.phase === "winner_char" ? "loser_char" : "ready";
      return s;
    }
    case "ready": {
      if (s.phase !== "ready") throw new SetError("Not ready phase");
      s.ready[slot] = true;
      if (s.ready[0] && s.ready[1]) s.phase = "playing";
      return s;
    }
  }
}

/** The set is ready to launch a game: stage and both characters known. */
export function gameSetup(s: SetState): { stage: StageId; chars: [string, string]; tiebreak: boolean } | null {
  if (!s.stage || !s.chars[0] || !s.chars[1]) return null;
  return { stage: s.stage, chars: [s.chars[0], s.chars[1]], tiebreak: s.tiebreakPending };
}

/** Record a finished game. `winner` null means a dead-even time-out: replay the last stock. */
export function recordGame(state: SetState, winner: 0 | 1 | null): SetState {
  const s = clone(state);
  if (s.phase !== "playing") throw new SetError("No game in progress");
  const setup = gameSetup(s);
  if (!setup) throw new SetError("Game had no setup");
  if (winner === null) {
    s.tiebreakPending = true;
    s.ready = [false, false];
    s.phase = "ready";
    return s;
  }
  s.games.push({ stage: setup.stage, chars: setup.chars, winner, tiebreak: s.tiebreakPending || undefined });
  s.tiebreakPending = false;
  s.score[winner]++;
  if (s.score[winner] >= WINS_NEEDED[s.format]) {
    s.phase = "complete";
    s.winner = winner;
    return s;
  }
  s.gameNumber++;
  s.banned = [];
  s.ready = [false, false];
  s.stage = null;
  s.blindSubmitted = [false, false];
  // Characters carry over as the default; the winner then the loser may change them.
  s.phase = winnerBanCount(s.format) > 0 ? "ban" : "counterpick";
  return s;
}

/** Forfeit by `slot` ends the set immediately for the other player. */
export function forfeit(state: SetState, slot: 0 | 1): SetState {
  const s = clone(state);
  s.phase = "complete";
  s.winner = (1 - slot) as 0 | 1;
  return s;
}
