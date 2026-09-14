// The engine boundary. The match room and the browser talk to the game through
// these types only, so the deterministic stub and the decomp-derived wasm
// engine are interchangeable. One engine instance = one game of a set.

import type { StageId } from "./rules.js";

/** One fighter's input for one frame. Stick axes are -1..1, buttons are a bitmask. */
export interface PlayerInput {
  x: number;
  y: number;
  buttons: number;
}

export const BTN = {
  A: 1 << 0,
  B: 1 << 1,
  JUMP: 1 << 2,
  SHIELD: 1 << 3,
  GRAB: 1 << 4,
  SPECIAL: 1 << 5,
} as const;

export const NULL_INPUT: PlayerInput = { x: 0, y: 0, buttons: 0 };

export interface PlayerState {
  slot: number;
  character: string;
  stocks: number;
  percent: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  /** Engine-defined action id (stub: 0 idle, 1 run, 2 air, 3 attack, 4 hitstun, 5 shield, 6 respawn). */
  action: number;
  actionFrames: number;
  /** Invincibility frames left (respawn). */
  invincible: number;
  ledgeGrabs: number;
}

export interface WorldState {
  tick: number;
  /** Frames left on the game clock. */
  timeLeft: number;
  players: PlayerState[];
}

export type GameEndReason = "stocks" | "timeout_stocks" | "timeout_percent" | "timeout_replay" | "lgl";

export type EngineEvent =
  | { type: "hit"; tick: number; attacker: number; victim: number; damage: number }
  | { type: "ko"; tick: number; victim: number; stocksLeft: number }
  | { type: "end"; tick: number; winner: 0 | 1 | null; reason: GameEndReason };

export interface EngineInit {
  seed: number;
  stage: StageId;
  characters: [string, string];
  stocks: number;
  timeSeconds: number;
}

/** A fixed-step, deterministic 1v1 game. Same inputs in, same state out, everywhere. */
export interface Engine {
  readonly kind: "stub" | "wasm";
  init(init: EngineInit): void;
  /** Advance exactly one frame with one input per slot. */
  step(inputs: [PlayerInput, PlayerInput]): EngineEvent[];
  state(): WorldState;
  /** Opaque snapshot for resync. */
  serialize(): Uint8Array;
  deserialize(data: Uint8Array): void;
}
