// One box of up to ROOM_CAP fighters. The room owns the authoritative engine
// instance, collects the latest input per slot, steps at TICK_RATE, and
// broadcasts packed snapshots at SNAPSHOT_RATE. It knows nothing about sockets
// beyond the tiny PlayerLink interface, which keeps it unit-testable.

import {
  MAX_ROOM_TICKS, NULL_INPUT, SNAPSHOT_RATE, TICK_RATE, packWorld, placementPoints,
  type Engine, type EngineEvent, type PlayerInput, type RoomPhase, type RoomResult, type RosterEntry,
} from "@owt/shared";

export interface PlayerLink {
  send(event: string, payload: unknown): void;
}

export interface RoomEntrant {
  userId: string;
  username: string;
}

export interface RoomFinish {
  roomId: string;
  roomIndex: number;
  entrants: number;
  results: { userId: string; place: number; kos: number; points: number }[];
}

export interface RoomOptions {
  id: string;
  eventId: string;
  index: number;
  seed: number;
  engine: Engine;
  entrants: RoomEntrant[];
  staminaHp: number;
  now?: () => number;
  onFinish: (finish: RoomFinish) => void;
}

const SNAPSHOT_EVERY = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE));

export class Room {
  readonly id: string;
  readonly eventId: string;
  readonly index: number;
  readonly seed: number;
  phase: RoomPhase = "waiting";
  startAt: number | null = null;

  private readonly engine: Engine;
  private readonly slots: RoomEntrant[];
  private readonly slotOf = new Map<string, number>();
  private readonly links = new Map<string, PlayerLink>();     // userId -> link (players)
  private readonly spectators = new Set<PlayerLink>();
  private readonly inputs: PlayerInput[];
  private readonly places = new Map<number, number>();        // slot -> place
  private readonly now: () => number;
  private readonly onFinish: (f: RoomFinish) => void;
  private tickAccumulator = 0;
  private lastTickAt = 0;

  constructor(opts: RoomOptions) {
    this.id = opts.id;
    this.eventId = opts.eventId;
    this.index = opts.index;
    this.seed = opts.seed;
    this.engine = opts.engine;
    this.slots = [...opts.entrants];
    this.slots.forEach((e, i) => this.slotOf.set(e.userId, i));
    this.inputs = this.slots.map(() => ({ ...NULL_INPUT }));
    this.now = opts.now ?? (() => Date.now());
    this.onFinish = opts.onFinish;
    this.engine.init({ seed: opts.seed, slots: this.slots.length, staminaHp: opts.staminaHp });
  }

  get entrants(): number { return this.slots.length; }
  get tick(): number { return this.engine.state().tick; }
  get engineKind() { return this.engine.kind; }

  roster(): RosterEntry[] {
    return this.slots.map((e, slot) => ({ slot, userId: e.userId, username: e.username, connected: this.links.has(e.userId) }));
  }

  /** Attach a socket. Returns the slot, or -1 for a spectator. Reconnects replace the old link. */
  attach(userId: string, link: PlayerLink): number {
    const slot = this.slotOf.get(userId);
    if (slot === undefined) { this.spectators.add(link); return -1; }
    this.links.set(userId, link);
    this.broadcast("room:roster", this.roster());
    return slot;
  }

  detach(userId: string, link: PlayerLink): void {
    if (this.spectators.delete(link)) return;
    if (this.links.get(userId) === link) {
      this.links.delete(userId);
      const slot = this.slotOf.get(userId);
      if (slot !== undefined) this.inputs[slot] = { ...NULL_INPUT };
      this.broadcast("room:roster", this.roster());
    }
  }

  setInput(userId: string, input: PlayerInput): void {
    const slot = this.slotOf.get(userId);
    if (slot === undefined || this.phase !== "live") return;
    const clamp = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
    this.inputs[slot] = { x: clamp(input.x), y: clamp(input.y), buttons: (input.buttons | 0) & 0xffff };
  }

  /** Begin the pre-match countdown; the first frame runs at startAt. */
  start(countdownMs: number): void {
    if (this.phase !== "waiting") return;
    this.phase = "countdown";
    this.startAt = this.now() + countdownMs;
    this.lastTickAt = this.startAt;
    this.broadcast("room:phase", { phase: this.phase, startAt: this.startAt });
  }

  void(): void {
    if (this.phase === "finished" || this.phase === "voided") return;
    this.phase = "voided";
    this.broadcast("room:phase", { phase: this.phase, startAt: null });
  }

  /** Drive the simulation from a coarse timer: runs however many frames wall-clock time owes. */
  pump(): void {
    const t = this.now();
    if (this.phase === "countdown" && this.startAt !== null && t >= this.startAt) {
      this.phase = "live";
      this.broadcast("room:phase", { phase: this.phase, startAt: this.startAt });
    }
    if (this.phase !== "live") return;
    this.tickAccumulator += t - this.lastTickAt;
    this.lastTickAt = t;
    const frameMs = 1000 / TICK_RATE;
    let frames = Math.floor((this.tickAccumulator + 1e-6) / frameMs); // epsilon: 60 x 16.67 ms must be 60 frames
    if (frames > 10) { frames = 10; this.tickAccumulator = 0; } // never spiral after a stall
    else this.tickAccumulator -= frames * frameMs;
    for (let i = 0; i < frames && this.phase === "live"; i++) this.stepOnce();
  }

  private stepOnce(): void {
    const events = this.engine.step(this.inputs);
    const state = this.engine.state();
    if (state.tick % SNAPSHOT_EVERY === 0) this.broadcast("room:snapshot", packWorld(state));
    if (events.length) this.handleEvents(events);
    if (this.phase === "live" && state.tick >= MAX_ROOM_TICKS) this.handleEvents(this.engine.forceEnd());
  }

  private handleEvents(events: EngineEvent[]): void {
    this.broadcast("room:events", events);
    for (const e of events) {
      if (e.type === "elim") {
        this.places.set(e.slot, e.place);
        this.sendTo(e.slot, "room:result", this.resultFor(e.slot));
      } else if (e.type === "end") {
        if (e.winner !== null) {
          this.places.set(e.winner, 1);
          this.sendTo(e.winner, "room:result", this.resultFor(e.winner));
        }
        this.finish();
      }
    }
  }

  private resultFor(slot: number): RoomResult {
    const place = this.places.get(slot) ?? this.entrants;
    const kos = this.engine.state().players[slot]?.kos ?? 0;
    return { place, entrants: this.entrants, points: placementPoints(place, this.entrants), kos };
  }

  private finish(): void {
    if (this.phase === "finished") return;
    this.phase = "finished";
    this.broadcast("room:phase", { phase: this.phase, startAt: this.startAt });
    const state = this.engine.state();
    const results = this.slots.map((e, slot) => {
      const place = this.places.get(slot) ?? this.entrants;
      return { userId: e.userId, place, kos: state.players[slot]?.kos ?? 0, points: placementPoints(place, this.entrants) };
    });
    this.onFinish({ roomId: this.id, roomIndex: this.index, entrants: this.entrants, results });
  }

  private sendTo(slot: number, event: string, payload: unknown): void {
    const e = this.slots[slot];
    if (!e) return;
    this.links.get(e.userId)?.send(event, payload);
  }

  private broadcast(event: string, payload: unknown): void {
    for (const l of this.links.values()) l.send(event, payload);
    for (const s of this.spectators) s.send(event, payload);
  }
}
