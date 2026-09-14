// The engine boundary. Everything above this line (room server, web client) talks
// to the game through these types only, so the deterministic stub engine and the
// decomp-derived wasm engine are interchangeable.

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
  alive: boolean;
  hp: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  /** Engine-defined action id (stub: 0 idle, 1 run, 2 jump, 3 attack, 4 hitstun, 5 shield). */
  action: number;
  /** Frames left in the current action. */
  actionFrames: number;
  kos: number;
}

export interface WorldState {
  tick: number;
  players: PlayerState[];
  alive: number;
}

export type EngineEvent =
  | { type: "hit"; tick: number; attacker: number; victim: number; damage: number }
  | { type: "elim"; tick: number; slot: number; by: number | null; place: number }
  | { type: "end"; tick: number; winner: number | null };

export interface EngineInit {
  seed: number;
  slots: number;
  staminaHp: number;
}

/** A fixed-step, deterministic game simulation. Same inputs in, same state out, everywhere. */
export interface Engine {
  readonly kind: "stub" | "wasm";
  init(init: EngineInit): void;
  /** Advance exactly one frame with one input per slot. */
  step(inputs: PlayerInput[]): EngineEvent[];
  state(): WorldState;
  /** Rank whoever is left (used at the tick cap). */
  forceEnd(): EngineEvent[];
  /** Opaque snapshot for late joiners / resync. */
  serialize(): Uint8Array;
  deserialize(data: Uint8Array): void;
}
