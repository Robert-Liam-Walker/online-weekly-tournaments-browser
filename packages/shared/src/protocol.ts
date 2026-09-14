// Socket protocol. "/lobby" is public (event + bracket updates); "/match" is
// authenticated and carries one player's current set.
import type { EngineEvent, PlayerInput } from "./engine-types.js";
import type { PackedWorld } from "./pack.js";
import type { SetAction, SetState } from "./set.js";

export type MatchPhase = "waiting" | "no_match" | "setup" | "countdown" | "live" | "between" | "complete" | "forfeited";

export interface MatchPlayer {
  userId: string;
  username: string;
  connected: boolean;
}

/** Everything a client needs to render its current match. Sent on join and on every change. */
export interface MatchView {
  eventId: string;
  matchKey: string | null;      // null while waiting for a match
  format: "BO3" | "BO5" | null;
  roundLabel: string | null;    // e.g. "Winners Round 2"
  slot: 0 | 1 | -1;             // -1 = spectator
  players: [MatchPlayer, MatchPlayer] | null;
  set: SetState | null;
  phase: MatchPhase;
  /** epoch ms when the current game starts (countdown) */
  startAt: number | null;
  engine: "stub" | "wasm";
  serverTime: number;
  /** who must act now, or null; mirrors set turn but also covers blind/ready */
  waitingOn: (0 | 1)[];
  noShowDeadline: number | null; // epoch ms after which the absent player forfeits
}

export interface ClientToMatch {
  "match:join": (p: { eventId: string }, ack: (r: MatchView | { error: string }) => void) => void;
  "match:action": (p: { action: SetAction }, ack: (r: { ok: true } | { error: string }) => void) => void;
  "match:input": (p: { input: PlayerInput }) => void;
  "match:leave": () => void;
}

export interface MatchToClient {
  "match:view": (v: MatchView) => void;
  "match:snapshot": (s: PackedWorld) => void;
  "match:events": (e: EngineEvent[]) => void;
}

/** Lobby namespace pushes. */
export interface LobbyEventUpdate {
  eventId: string;
  status: string;
  registered: number;
  present: number;
}

export interface BracketUpdate {
  eventId: string;
}
