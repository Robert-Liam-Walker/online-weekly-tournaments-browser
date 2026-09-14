// MatchClient: the browser side of the /match protocol. Joins the event, keeps
// the latest MatchView, applies set actions with acks, sends inputs at 60 Hz
// while a game is live, and keeps the last two snapshots for interpolation.
import { io, type Socket } from "socket.io-client";
import { TICK_RATE, unpackWorld, type EngineEvent, type MatchView, type PackedWorld, type SetAction, type WorldState } from "@owt/shared";
import { getToken, SOCKET_URL } from "../lib/api";
import { readInput, startInput, stopInput } from "./input";

export interface ClientState {
  view: MatchView | null;
  connected: boolean;
  error: string | null;
}

type Listener = (s: ClientState) => void;

export class MatchClient {
  private socket: Socket | null = null;
  private inputTimer: number | null = null;
  private serverOffset = 0;
  state: ClientState = { view: null, connected: false, error: null };
  world: WorldState | null = null;
  prevWorld: WorldState | null = null;
  worldAt = 0;
  private listeners = new Set<Listener>();
  onEvents: ((e: EngineEvent[]) => void) | null = null;

  subscribe(l: Listener): () => void { this.listeners.add(l); l(this.state); return () => this.listeners.delete(l); }
  private set(patch: Partial<ClientState>) { this.state = { ...this.state, ...patch }; for (const l of this.listeners) l(this.state); }

  connect(eventId: string): void {
    this.disconnect();
    const s = io(`${SOCKET_URL ?? ""}/match`, { transports: ["websocket"], auth: { token: getToken() } });
    this.socket = s;
    s.on("connect", () => {
      this.set({ connected: true, error: null });
      s.emit("match:join", { eventId }, (r: MatchView | { error: string }) => {
        if ("error" in r) { this.set({ error: r.error }); return; }
        this.applyView(r);
      });
    });
    s.on("connect_error", (err) => this.set({ connected: false, error: err.message || "Connection failed" }));
    s.on("disconnect", () => { this.set({ connected: false }); this.stopSendingInput(); });
    s.on("match:view", (v: MatchView) => this.applyView(v));
    s.on("match:snapshot", (pw: PackedWorld) => { this.prevWorld = this.world; this.world = unpackWorld(pw); this.worldAt = performance.now(); });
    s.on("match:events", (e: EngineEvent[]) => this.onEvents?.(e));
  }

  private applyView(v: MatchView) {
    this.serverOffset = v.serverTime - Date.now();
    const wasLive = this.state.view?.phase === "live";
    if (v.phase !== "live" && v.phase !== "countdown" && wasLive) { this.world = null; this.prevWorld = null; }
    if (v.phase === "countdown" && this.state.view?.phase !== "countdown") { this.world = null; this.prevWorld = null; }
    this.set({ view: v, error: null });
    if ((v.phase === "live" || v.phase === "countdown") && v.slot >= 0) this.startSendingInput();
    else this.stopSendingInput();
  }

  act(action: SetAction): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error("Not connected"));
      this.socket.emit("match:action", { action }, (r: { ok: true } | { error: string }) => {
        if ("error" in r) reject(new Error(r.error)); else resolve();
      });
    });
  }

  serverNow(): number { return Date.now() + this.serverOffset; }

  private startSendingInput() {
    if (this.inputTimer !== null) return;
    startInput();
    this.inputTimer = window.setInterval(() => {
      const v = this.state.view;
      if (!v || v.slot < 0 || v.phase !== "live") return;
      this.socket?.emit("match:input", { input: readInput() });
    }, 1000 / TICK_RATE);
  }

  private stopSendingInput() {
    if (this.inputTimer !== null) { clearInterval(this.inputTimer); this.inputTimer = null; }
    stopInput();
  }

  disconnect(): void {
    this.stopSendingInput();
    this.socket?.emit("match:leave");
    this.socket?.disconnect();
    this.socket = null;
    this.world = null; this.prevWorld = null;
    this.set({ connected: false });
  }
}
