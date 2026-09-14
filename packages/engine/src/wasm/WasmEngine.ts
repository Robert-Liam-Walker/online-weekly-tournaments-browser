// WasmEngine: the decomp-derived engine. The wasm module is produced by
// packages/engine/build (see README.md) and is not committed. Until it exists,
// createEngine("wasm") throws EngineNotBuiltError and callers fall back to the stub.

import type { Engine, EngineEvent, EngineInit, PlayerInput, WorldState } from "@owt/shared";

export class EngineNotBuiltError extends Error {
  constructor() {
    super("The wasm engine has not been built. Run packages/engine/build/build.sh (Linux/CI) and place engine.wasm in packages/engine/wasm/.");
    this.name = "EngineNotBuiltError";
  }
}

/** C ABI the wasm module must export. Kept here so the build and the loader agree. */
export interface WasmEngineExports {
  memory: WebAssembly.Memory;
  owt_init(seed: number, slots: number, staminaHp: number): void;
  owt_set_input(slot: number, x: number, y: number, buttons: number): void;
  owt_step(): number;               // returns number of pending events
  owt_force_end(): number;
  owt_events_ptr(): number;         // pointer to a packed event array (EVENT_STRIDE bytes each)
  owt_player_ptr(slot: number): number; // pointer to a packed player record (PLAYER_STRIDE bytes)
  owt_tick(): number;
  owt_alive(): number;
  owt_snapshot_size(): number;
  owt_snapshot_write(dst: number): void;
  owt_snapshot_read(src: number, len: number): void;
  owt_malloc(n: number): number;
  owt_free(p: number): void;
}

export const EVENT_STRIDE = 20; // u32 type, u32 tick, i32 a, i32 b, f32 value
export const PLAYER_STRIDE = 44; // u32 alive, f32 hp x y vx vy, i32 facing, u32 action actionFrames kos, u32 pad

export class WasmEngine implements Engine {
  readonly kind = "wasm" as const;
  private constructor(private readonly ex: WasmEngineExports, private slots: number) {}

  static async load(source: Response | ArrayBuffer | Uint8Array): Promise<WasmEngine> {
    const imports = { env: { owt_log: (_ptr: number, _len: number) => { /* wired by host */ } } };
    const result = source instanceof Response
      ? await WebAssembly.instantiateStreaming(source, imports)
      : await WebAssembly.instantiate(source as ArrayBuffer, imports);
    return new WasmEngine(result.instance.exports as unknown as WasmEngineExports, 0);
  }

  init(init: EngineInit): void {
    this.slots = init.slots;
    this.ex.owt_init(init.seed, init.slots, init.staminaHp);
  }

  step(inputs: PlayerInput[]): EngineEvent[] {
    for (let i = 0; i < this.slots; i++) {
      const inp = inputs[i];
      this.ex.owt_set_input(i, inp?.x ?? 0, inp?.y ?? 0, inp?.buttons ?? 0);
    }
    return this.drainEvents(this.ex.owt_step());
  }

  forceEnd(): EngineEvent[] {
    return this.drainEvents(this.ex.owt_force_end());
  }

  private drainEvents(n: number): EngineEvent[] {
    const events: EngineEvent[] = [];
    const base = this.ex.owt_events_ptr();
    const dv = new DataView(this.ex.memory.buffer);
    for (let i = 0; i < n; i++) {
      const o = base + i * EVENT_STRIDE;
      const type = dv.getUint32(o, true), tick = dv.getUint32(o + 4, true);
      const a = dv.getInt32(o + 8, true), b = dv.getInt32(o + 12, true), v = dv.getFloat32(o + 16, true);
      if (type === 1) events.push({ type: "hit", tick, attacker: a, victim: b, damage: v });
      else if (type === 2) events.push({ type: "elim", tick, slot: a, by: b < 0 ? null : b, place: v });
      else if (type === 3) events.push({ type: "end", tick, winner: a < 0 ? null : a });
    }
    return events;
  }

  state(): WorldState {
    const dv = new DataView(this.ex.memory.buffer);
    const players = [];
    for (let i = 0; i < this.slots; i++) {
      const o = this.ex.owt_player_ptr(i);
      players.push({
        slot: i,
        alive: dv.getUint32(o, true) !== 0,
        hp: dv.getFloat32(o + 4, true),
        x: dv.getFloat32(o + 8, true), y: dv.getFloat32(o + 12, true),
        vx: dv.getFloat32(o + 16, true), vy: dv.getFloat32(o + 20, true),
        facing: (dv.getInt32(o + 24, true) < 0 ? -1 : 1) as 1 | -1,
        action: dv.getUint32(o + 28, true), actionFrames: dv.getUint32(o + 32, true),
        kos: dv.getUint32(o + 36, true),
      });
    }
    return { tick: this.ex.owt_tick(), players, alive: this.ex.owt_alive() };
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
