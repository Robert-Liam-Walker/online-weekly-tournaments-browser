// Room socket protocol (socket.io event names + payloads). One namespace, "/room".
import type { PlayerInput, EngineEvent } from "./engine-types.js";
import type { PackedWorld } from "./pack.js";

export type RoomPhase = "waiting" | "countdown" | "live" | "finished" | "voided";

export interface RosterEntry {
  slot: number;
  userId: string;
  username: string;
  connected: boolean;
}

export interface RoomWelcome {
  roomId: string;
  eventId: string;
  roomIndex: number;
  slot: number;            // -1 for spectators
  phase: RoomPhase;
  startAt: number | null;  // epoch ms when the first frame runs
  tick: number;
  seed: number;
  roster: RosterEntry[];
  engine: "stub" | "wasm";
  serverTime: number;      // epoch ms, for clock offset
}

export interface RoomResult {
  place: number;
  entrants: number;
  points: number;
  kos: number;
}

/** Client -> server events. */
export interface ClientToRoom {
  "room:join": (p: { eventId: string }, ack: (r: RoomWelcome | { error: string }) => void) => void;
  "room:input": (p: { input: PlayerInput }) => void;
  "room:leave": () => void;
}

/** Server -> client events. */
export interface RoomToClient {
  "room:roster": (roster: RosterEntry[]) => void;
  "room:phase": (p: { phase: RoomPhase; startAt: number | null }) => void;
  "room:snapshot": (s: PackedWorld) => void;
  "room:events": (e: EngineEvent[]) => void;
  "room:result": (r: RoomResult) => void;
}

/** Lobby namespace ("/lobby") pushes registration counts and phase changes. */
export interface LobbyEventUpdate {
  eventId: string;
  status: string;
  registered: number;
  present: number;
}
