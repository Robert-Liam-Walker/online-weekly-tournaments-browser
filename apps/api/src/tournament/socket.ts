// socket.io wiring: "/lobby" (public event + bracket pushes) and "/match"
// (authenticated: a player's current set).

import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type { LobbyEventUpdate, MatchView, PlayerInput, SetAction } from "@owt/shared";
import { prisma } from "../lib/prisma.js";
import type { TournamentManager } from "./TournamentManager.js";
import type { PlayerLink } from "./MatchRoom.js";
import type { JwtUser } from "../plugins/auth.js";

export class LobbyHub {
  constructor(private readonly io: Server, private readonly tm: TournamentManager) {}

  async broadcast(eventId: string): Promise<void> {
    const e = await prisma.weeklyEvent.findUnique({ where: { id: eventId } });
    if (!e) return;
    const registered = await prisma.registration.count({ where: { eventId } });
    const payload: LobbyEventUpdate = { eventId, status: e.status, registered, present: this.tm.presentCount(eventId) };
    this.io.of("/lobby").emit("lobby:event", payload);
  }

  bracketChanged(eventId: string): void {
    this.io.of("/lobby").emit("lobby:bracket", { eventId });
  }
}

class SocketLink implements PlayerLink {
  constructor(private readonly socket: Socket) {}
  send(event: string, payload: unknown) { this.socket.emit(event, payload); }
}

export function attachSockets(app: FastifyInstance, httpServer: HttpServer, tm: TournamentManager, corsOrigins: string[]): { io: Server; lobby: LobbyHub } {
  const io = new Server(httpServer, { cors: { origin: corsOrigins, credentials: true }, path: "/socket.io" });
  const lobby = new LobbyHub(io, tm);
  io.of("/lobby");

  const match = io.of("/match");
  match.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    if (!token) return next(new Error("Not signed in"));
    try { socket.data.user = app.jwt.verify<JwtUser>(token); next(); }
    catch { next(new Error("Session expired")); }
  });

  match.on("connection", (socket) => {
    const user = socket.data.user as JwtUser;
    const link = new SocketLink(socket);
    let joinedEvent: string | null = null;

    const waitingView = (eventId: string, phase: MatchView["phase"]): MatchView => ({
      eventId, matchKey: null, format: null, roundLabel: null, slot: -1, players: null, set: null, phase, startAt: null, engine: "stub", serverTime: Date.now(), waitingOn: [], noShowDeadline: null,
    });

    socket.on("match:join", async (p: { eventId: string }, ack: (r: MatchView | { error: string }) => void) => {
      try {
        const eventId = String(p?.eventId ?? "");
        const e = await prisma.weeklyEvent.findUnique({ where: { id: eventId } });
        if (!e) return ack({ error: "No such event" });
        const reg = await prisma.registration.findUnique({ where: { userId_eventId: { userId: user.id, eventId } } });
        joinedEvent = eventId;
        tm.rememberLink({ userId: user.id, username: user.username, link });
        const room = tm.roomFor(eventId, user.id);
        if (room) { const slot = room.attach(user.id, link); return ack(room.view(slot)); }
        if (e.status === "LIVE") {
          if (!reg) return ack({ error: "You are not in this bracket" });
          const out = tm.isEliminated(eventId, user.id);
          return ack(waitingView(eventId, out ? "complete" : "no_match"));
        }
        if (e.status !== "LOBBY" && e.status !== "SCHEDULED") return ack({ error: e.status === "COMPLETE" ? "This event has finished" : "This event is not open" });
        if (!reg) return ack({ error: "Register for this event first" });
        tm.markPresent(eventId, { userId: user.id, username: user.username, link });
        await lobby.broadcast(eventId);
        return ack(waitingView(eventId, "waiting"));
      } catch (err) {
        app.log.error(err, "match:join failed");
        ack({ error: "Could not join" });
      }
    });

    socket.on("match:action", (p: { action: SetAction }, ack?: (r: { ok: true } | { error: string }) => void) => {
      try {
        if (!joinedEvent) throw new Error("Join an event first");
        const room = tm.roomFor(joinedEvent, user.id);
        if (!room) throw new Error("You have no match right now");
        room.action(user.id, p.action);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ error: (err as Error).message });
      }
    });

    socket.on("match:input", (p: { input: PlayerInput }) => {
      if (!joinedEvent || !p?.input) return;
      tm.roomFor(joinedEvent, user.id)?.setInput(user.id, p.input);
    });

    const leave = () => {
      if (!joinedEvent) return;
      tm.roomFor(joinedEvent, user.id)?.detach(user.id, link);
      tm.markAbsent(joinedEvent, user.id, link);
      tm.forgetLink(user.id, link);
      void lobby.broadcast(joinedEvent);
      joinedEvent = null;
    };
    socket.on("match:leave", leave);
    socket.on("disconnect", leave);
  });

  return { io, lobby };
}
