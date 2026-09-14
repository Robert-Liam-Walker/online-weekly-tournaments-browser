// WasmEngine: the decomp-derived engine. The wasm module is produced by
// packages/engine/build (see README.md) and is not committed. Until it exists,
// createEngine("wasm") throws EngineNotBuiltError and callers fall back to the stub.

import { stageById, characterById, type Engine, type EngineEvent, type EngineInit, type PlayerInput, type WorldState, type GameEndReason } from "@owt/shared";

export class EngineNotBuiltError extends Error {
  constructor() {
    super("The wasm engine has not been built. Run packages/engine/build/build.sh (Linux/CI) and place engine.wasm in packages/engine/wasm/.");
    this.name = "EngineNotBuiltError";
  }
}

/** C ABI the wasm module must export. Kept here so the build and the loader agree. */
export interface WasmEngineExports {
  memory: WebAssembly.Memory;
  owt_init(seed: number, stageId: number, char0: number, char1: number, stocks: number, timeFrames: number): void;
  owt_set_input(slot: number, x: number, y: number, buttons: number): void;
  owt_step(): number;               // returns number of pending events
  owt_events_ptr(): number;         // packed events, EVENT_STRIDE bytes each
  owt_player_ptr(slot: number): number; // packed player record, PLAYER_STRIDE bytes
  owt_tick(): number;
  owt_time_left(): number;
  owt_snapshot_size(): number;
  owt_snapshot_write(dst: number): void;
  owt_snapshot_read(src: number, len: number): void;
  owt_malloc(n: number): number;
  owt_free(p: number): void;
}

export const EVENT_STRIDE = 20; // u32 type, u32 tick, i32 a, i32 b, f32 value
export const PLAYER_STRIDE = 48; // u32 stocks, f32 percent x y vx vy, i32 facing, u32 action actionFrames invincible ledgeGrabs, u32 pad
const END_REASONS: GameEndReason[] = ["stocks", "timeout_stocks", "timeout_percent", "timeout_replay", "lgl"];

export class WasmEngine implements Engine {
  readonly kind = "wasm" as const;
  private chars: [string, string] = ["fox", "fox"];
  private constructor(private readonly ex: WasmEngineExports) {}

  static async load(source: Response | ArrayBuffer | Uint8Array): Promise<WasmEngine> {
    const imports = { env: { owt_log: (_ptr: number, _len: number) => { /* wired by host */ } } };
    const result = source instanceof Response
      ? await WebAssembly.instantiateStreaming(source, imports)
      : await WebAssembly.instantiate(source as ArrayBuffer, imports);
    return new WasmEngine(result.instance.exports as unknown as WasmEngineExports);
  }

  init(init: EngineInit): void {
    this.chars = init.characters;
    const stage = stageById(init.stage)?.meleeId ?? 0x20;
    const c0 = characterById(init.characters[0])?.meleeId ?? 2, c1 = characterById(init.characters[1])?.meleeId ?? 2;
    this.ex.owt_init(init.seed, stage, c0, c1, init.stocks, init.timeSeconds * 60);
  }

  step(inputs: [PlayerInput, PlayerInput]): EngineEvent[] {
    for (let i = 0; i < 2; i++) { const inp = inputs[i]; this.ex.owt_set_input(i, inp?.x ?? 0, inp?.y ?? 0, inp?.buttons ?? 0); }
    const n = this.ex.owt_step();
    const events: EngineEvent[] = [];
    const base = this.ex.owt_events_ptr();
    const dv = new DataView(this.ex.memory.buffer);
    for (let i = 0; i < n; i++) {
      const o = base + i * EVENT_STRIDE;
      const type = dv.getUint32(o, true), tick = dv.getUint32(o + 4, true);
      const a = dv.getInt32(o + 8, true), b = dv.getInt32(o + 12, true), v = dv.getFloat32(o + 16, true);
      if (type === 1) events.push({ type: "hit", tick, attacker: a, victim: b, damage: v });
      else if (type === 2) events.push({ type: "ko", tick, victim: a, stocksLeft: b });
      else if (type === 3) events.push({ type: "end", tick, winner: a < 0 ? null : (a as 0 | 1), reason: END_REASONS[b] ?? "stocks" });
    }
    return events;
  }

  state(): WorldState {
    const dv = new DataView(this.ex.memory.buffer);
    const players = [];
    for (let i = 0; i < 2; i++) {
      const o = this.ex.owt_player_ptr(i);
      players.push({
        slot: i, character: this.chars[i]!,
        stocks: dv.getUint32(o, true), percent: dv.getFloat32(o + 4, true),
        x: dv.getFloat32(o + 8, true), y: dv.getFloat32(o + 12, true), vx: dv.getFloat32(o + 16, true), vy: dv.getFloat32(o + 20, true),
        facing: (dv.getInt32(o + 24, true) < 0 ? -1 : 1) as 1 | -1,
        action: dv.getUint32(o + 28, true), actionFrames: dv.getUint32(o + 32, true), invincible: dv.getUint32(o + 36, true), ledgeGrabs: dv.getUint32(o + 40, true),
      });
    }
    return { tick: this.ex.owt_tick(), timeLeft: this.ex.owt_time_left(), players };
  }

  serialize(): Uint8Array {
    const n = this.ex.owt_snapshot_size();
    const p = this.ex.owt_malloc(n);
    this.ex.owt_snapshot_write(p);
    const out = new Uint8Array(this.ex.memory.buffer, p, n).slice();
    this.ex.owt_free(p);
    return out;
  }

  deserialize(data: Uint8Array): void {
    const p = this.ex.owt_malloc(data.length);
    new Uint8Array(this.ex.memory.buffer, p, data.length).set(data);
    this.ex.owt_snapshot_read(p, data.length);
    this.ex.owt_free(p);
  }
}
