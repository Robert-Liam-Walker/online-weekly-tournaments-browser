// GameClient: the browser side of the room protocol. Connects to /room, joins
// an event, sends inputs at 60 Hz, receives snapshots at 20 Hz, and keeps the
// last two snapshots so the renderer can interpolate between them.
import { io, type Socket } from "socket.io-client";
import { TICK_RATE, unpackWorld, type EngineEvent, type PackedWorld, type RoomPhase, type RoomResult, type RoomWelcome, type RosterEntry, type WorldState } from "@owt/shared";
import { getToken, SOCKET_URL } from "../lib/api";
import { readInput, startInput, stopInput } from "./input";

export interface ClientState {
  phase: RoomPhase;
  startAt: number | null;
  slot: number;
  roomIndex: number;
  roster: RosterEntry[];
  result: RoomResult | null;
  engine: "stub" | "wasm";
  error: string | null;
  connected: boolean;
}

type Listener = (s: ClientState) => void;

export class GameClient {
  private socket: Socket | null = null;
  private inputTimer: number | null = null;
  private serverOffset = 0;
  state: ClientState = { phase: "waiting", startAt: null, slot: -1, roomIndex: -1, roster: [], result: null, engine: "stub", error: null, connected: false };
  world: WorldState | null = null;
  prevWorld: WorldState | null = null;
  worldAt = 0;
  private listeners = new Set<Listener>();
  onEvents: ((e: EngineEvent[]) => void) | null = null;

  subscribe(l: Listener): () => void { this.listeners.add(l); l(this.state); return () => this.listeners.delete(l); }
  private set(patch: Partial<ClientState>) { this.state = { ...this.state, ...patch }; for (const l of this.listeners) l(this.state); }

  connect(eventId: string): void {
    this.disconnect();
    const s = io(`${SOCKET_URL ?? ""}/room`, { transports: ["websocket"], auth: { token: getToken() } });
    this.socket = s;
    s.on("connect", () => {
      this.set({ connected: true, error: null });
      s.emit("room:join", { eventId }, (r: RoomWelcome | { error: string }) => {
        if ("error" in r) { this.set({ error: r.error }); return; }
        this.serverOffset = r.serverTime - Date.now();
        this.set({ phase: r.phase, startAt: r.startAt, slot: r.slot, roomIndex: r.roomIndex, roster: r.roster, engine: r.engine, error: null });
        if (r.phase === "live" || r.phase === "countdown") this.startSendingInput();
      });
    });
    s.on("connect_error", (err) => this.set({ connected: false, error: err.message || "Connection failed" }));
    s.on("disconnect", () => { this.set({ connected: false }); this.stopSendingInput(); });
    s.on("room:assigned", (a: { roomIndex: number; slot: number; startAt: number; roster: RosterEntry[]; engine: "stub" | "wasm" }) => {
      this.set({ phase: "countdown", startAt: a.startAt, slot: a.slot, roomIndex: a.roomIndex, roster: a.roster, engine: a.engine });
      this.startSendingInput();
    });
    s.on("room:phase", (p: { phase: RoomPhase; startAt: number | null }) => {
      this.set({ phase: p.phase, startAt: p.startAt });
      if (p.phase === "live") this.startSendingInput();
      if (p.phase === "finished" || p.phase === "voided") this.stopSendingInput();
    });
    s.on("room:roster", (roster: RosterEntry[]) => this.set({ roster }));
    s.on("room:snapshot", (pw: PackedWorld) => {
      this.prevWorld = this.world;
      this.world = unpackWorld(pw);
      this.worldAt = performance.now();
    });
    s.on("room:events", (e: EngineEvent[]) => this.onEvents?.(e));
    s.on("room:result", (r: RoomResult) => this.set({ result: r }));
  }

  /** Server clock estimate, for the countdown. */
  serverNow(): number { return Date.now() + this.serverOffset; }

  private startSendingInput() {
    if (this.inputTimer !== null) return;
    startInput();
    this.inputTimer = window.setInterval(() => {
      if (this.state.slot < 0 || this.state.phase !== "live") return;
      this.socket?.emit("room:input", { input: readInput() });
    }, 1000 / TICK_RATE);
  }

  private stopSendingInput() {
    if (this.inputTimer !== null) { clearInterval(this.inputTimer); this.inputTimer = null; }
    stopInput();
  }

  disconnect(): void {
    this.stopSendingInput();
    this.socket?.emit("room:leave");
    this.socket?.disconnect();
    this.socket = null;
    this.world = null; this.prevWorld = null;
    this.set({ connected: false });
  }
}
