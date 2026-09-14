// One set between two players. Owns the SetState (picks, score), the engine
// for the game in progress, the two player links, the no-show and disconnect
// clocks, and pushes a MatchView to everyone attached whenever anything
// changes. Knows nothing about sockets beyond PlayerLink, so it is unit-testable.

import {
  DISCONNECT_FORFEIT_MINUTES, NO_SHOW_FORFEIT_MINUTES, SETUP_ACTION_MINUTES, SNAPSHOT_RATE, START_COUNTDOWN_SECONDS, STOCKS, TICK_RATE, TIEBREAK_REPLAY_MINUTES, TIEBREAK_REPLAY_STOCKS, TIME_MINUTES,
  applyAction, createSet, forfeit, gameSetup, NULL_INPUT, packWorld, recordGame, turnOf,
  type Engine, type EngineEvent, type MatchPhase, type MatchView, type PlayerInput, type SetAction, type SetFormat, type SetState,
} from "@owt/shared";

export interface PlayerLink {
  send(event: string, payload: unknown): void;
}

export interface MatchPlayerInfo { userId: string; username: string }

export interface MatchRoomOptions {
  eventId: string;
  matchKey: string;
  roundLabel: string;
  format: SetFormat;
  players: [MatchPlayerInfo, MatchPlayerInfo];
  firstStriker: 0 | 1;
  seed: number;
  makeEngine: () => Promise<Engine>;
  now?: () => number;
  onComplete: (result: { winnerSlot: 0 | 1; set: SetState; forfeit: boolean }) => void;
  onChange?: () => void;
}

const SNAPSHOT_EVERY = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE));

export class MatchRoom {
  readonly eventId: string;
  readonly matchKey: string;
  set: SetState;
  phase: MatchPhase = "waiting";
  startAt: number | null = null;
  forfeited = false;
  private engine: Engine | null = null;
  private engineKind: "stub" | "wasm" = "stub";
  private readonly links: [PlayerLink | null, PlayerLink | null] = [null, null];
  private readonly spectators = new Set<PlayerLink>();
  private readonly inputs: [PlayerInput, PlayerInput] = [{ ...NULL_INPUT }, { ...NULL_INPUT }];
  private readonly createdAt: number;
  private readonly disconnectedAt: [number | null, number | null] = [null, null];
  private readonly opts: MatchRoomOptions;
  private readonly now: () => number;
  private accumulator = 0;
  private lastTickAt = 0;
  private gameSeed: number;
  private launching = false;
  /** When the current setup step began; a player who ignores it forfeits after SETUP_ACTION_MINUTES. */
  private stepStartedAt: number;

  constructor(opts: MatchRoomOptions) {
    this.opts = opts;
    this.eventId = opts.eventId;
    this.matchKey = opts.matchKey;
    this.now = opts.now ?? (() => Date.now());
    this.createdAt = this.now();
    this.gameSeed = opts.seed;
    this.set = createSet([opts.players[0].userId, opts.players[1].userId], opts.format, opts.firstStriker);
    this.disconnectedAt = [this.createdAt, this.createdAt];
    this.stepStartedAt = this.createdAt;
  }

  get players() { return this.opts.players; }
  get done() { return this.phase === "complete" || this.phase === "forfeited"; }

  slotOf(userId: string): 0 | 1 | -1 {
    return this.opts.players[0].userId === userId ? 0 : this.opts.players[1].userId === userId ? 1 : -1;
  }

  attach(userId: string, link: PlayerLink): 0 | 1 | -1 {
    const slot = this.slotOf(userId);
    if (slot === -1) { this.spectators.add(link); link.send("match:view", this.view(-1)); return -1; }
    this.links[slot] = link;
    this.disconnectedAt[slot] = null;
    this.stepStartedAt = this.now();
    if (this.phase === "waiting" && this.links[0] && this.links[1]) { this.phase = "setup"; this.stepStartedAt = this.now(); }
    this.broadcast();
    return slot;
  }

  detach(userId: string, link: PlayerLink): void {
    if (this.spectators.delete(link)) return;
    const slot = this.slotOf(userId);
    if (slot === -1 || this.links[slot] !== link) return;
    this.links[slot] = null;
    this.disconnectedAt[slot] = this.now();
    this.inputs[slot] = { ...NULL_INPUT };
    this.broadcast();
  }

  action(userId: string, action: SetAction): void {
    const slot = this.slotOf(userId);
    if (slot === -1) throw new Error("Spectators cannot act");
    if (this.done) throw new Error("This set is over");
    if (this.phase === "waiting") throw new Error("Waiting for your opponent");
    this.set = applyAction(this.set, slot, action);
    this.stepStartedAt = this.now();
    if (this.set.phase === "playing") void this.launchGame();
    this.broadcast();
  }

  setInput(userId: string, input: PlayerInput): void {
    const slot = this.slotOf(userId);
    if (slot === -1 || this.phase !== "live") return;
    const clamp = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
    this.inputs[slot] = { x: clamp(input.x), y: clamp(input.y), buttons: (input.buttons | 0) & 0xffff };
  }

  /** TO override or system forfeit. */
  forfeitSlot(slot: 0 | 1): void {
    if (this.done) return;
    this.set = forfeit(this.set, slot);
    this.forfeited = true;
    this.engine = null;
    this.phase = "forfeited";
    this.broadcast();
    this.opts.onComplete({ winnerSlot: this.set.winner!, set: this.set, forfeit: true });
  }

  private async launchGame(): Promise<void> {
    if (this.launching) return;
    this.launching = true;
    try {
      const setup = gameSetup(this.set);
      if (!setup) return;
      this.engine = await this.opts.makeEngine();
      this.engineKind = this.engine.kind;
      this.gameSeed = (this.gameSeed * 1103515245 + 12345) >>> 0;
      this.engine.init({
        seed: this.gameSeed, stage: setup.stage, characters: setup.chars,
        stocks: setup.tiebreak ? TIEBREAK_REPLAY_STOCKS : STOCKS,
        timeSeconds: (setup.tiebreak ? TIEBREAK_REPLAY_MINUTES : TIME_MINUTES) * 60,
      });
      this.inputs[0] = { ...NULL_INPUT }; this.inputs[1] = { ...NULL_INPUT };
      this.phase = "countdown";
      this.startAt = this.now() + START_COUNTDOWN_SECONDS * 1000;
      this.lastTickAt = this.startAt;
      this.accumulator = 0;
      this.broadcast();
    } finally {
      this.launching = false;
    }
  }

  /** Drive clocks and the simulation from a coarse timer. */
  pump(): void {
    if (this.done) return;
    const t = this.now();

    // No-show: a player who never connected within the window forfeits.
    for (const slot of [0, 1] as const) {
      const away = this.disconnectedAt[slot];
      if (away === null) continue;
      const limitMs = (this.phase === "waiting" ? NO_SHOW_FORFEIT_MINUTES : DISCONNECT_FORFEIT_MINUTES) * 60_000;
      if (t - away >= limitMs) { this.forfeitSlot(slot); return; }
    }

    // Setup inactivity: whoever the set is waiting on forfeits after SETUP_ACTION_MINUTES.
    // The clock only runs while both players are connected; a reconnect restarts it.
    if (this.phase === "setup" && this.links[0] && this.links[1] && t - this.stepStartedAt >= SETUP_ACTION_MINUTES * 60_000) {
      const idle = this.waitingOn();
      if (idle.length === 1) { this.forfeitSlot(idle[0]!); return; }
      if (idle.length === 2) { this.forfeitSlot(1); return; } // both idle: the higher seed (slot 0) advances
    }

    if (this.phase === "countdown" && this.startAt !== null && t >= this.startAt) {
      this.phase = "live";
      this.broadcast();
    }
    if (this.phase !== "live" || !this.engine) return;
    this.accumulator += t - this.lastTickAt;
    this.lastTickAt = t;
    const frameMs = 1000 / TICK_RATE;
    let frames = Math.floor((this.accumulator + 1e-6) / frameMs);
    if (frames > 10) { frames = 10; this.accumulator = 0; } else this.accumulator -= frames * frameMs;
    for (let i = 0; i < frames && this.phase === "live"; i++) this.stepOnce();
  }

  private stepOnce(): void {
    const engine = this.engine!;
    const events = engine.step(this.inputs);
    const state = engine.state();
    if (state.tick % SNAPSHOT_EVERY === 0) this.emitAll("match:snapshot", packWorld(state));
    if (events.length) this.handleEvents(events);
  }

  private handleEvents(events: EngineEvent[]): void {
    this.emitAll("match:events", events);
    const end = events.find((e): e is Extract<EngineEvent, { type: "end" }> => e.type === "end");
    if (!end) return;
    this.engine = null;
    this.set = recordGame(this.set, end.winner);
    if (this.set.phase === "complete") {
      this.phase = "complete";
      this.broadcast();
      this.opts.onComplete({ winnerSlot: this.set.winner!, set: this.set, forfeit: false });
    } else {
      this.phase = "setup";
      this.startAt = null;
      this.stepStartedAt = this.now();
      this.broadcast();
    }
  }

  private waitingOn(): (0 | 1)[] {
    const s = this.set;
    if (this.phase === "waiting") return ([0, 1] as const).filter((i) => !this.links[i]);
    if (this.done || this.phase === "live" || this.phase === "countdown") return [];
    if (s.phase === "blind_pick") return ([0, 1] as const).filter((i) => !s.blindSubmitted[i]);
    if (s.phase === "ready") return ([0, 1] as const).filter((i) => !s.ready[i]);
    const t = turnOf(s);
    return t === null ? [] : [t];
  }

  view(slot: 0 | 1 | -1): MatchView {
    const absent = ([0, 1] as const).find((i) => this.disconnectedAt[i] !== null);
    const deadline = absent !== undefined && !this.done
      ? this.disconnectedAt[absent]! + (this.phase === "waiting" ? NO_SHOW_FORFEIT_MINUTES : DISCONNECT_FORFEIT_MINUTES) * 60_000
      : this.phase === "setup" && this.links[0] && this.links[1] ? this.stepStartedAt + SETUP_ACTION_MINUTES * 60_000 : null;
    return {
      eventId: this.eventId,
      matchKey: this.matchKey,
      format: this.opts.format,
      roundLabel: this.opts.roundLabel,
      slot,
      players: [
        { ...this.opts.players[0], connected: !!this.links[0] },
        { ...this.opts.players[1], connected: !!this.links[1] },
      ],
      set: this.set,
      phase: this.phase,
      startAt: this.startAt,
      engine: this.engineKind,
      serverTime: this.now(),
      waitingOn: this.waitingOn(),
      noShowDeadline: deadline,
    };
  }

  private broadcast(): void {
    for (const slot of [0, 1] as const) this.links[slot]?.send("match:view", this.view(slot));
    for (const s of this.spectators) s.send("match:view", this.view(-1));
    this.opts.onChange?.();
  }

  private emitAll(event: string, payload: unknown): void {
    for (const l of this.links) l?.send(event, payload);
    for (const s of this.spectators) s.send(event, payload);
  }
}
