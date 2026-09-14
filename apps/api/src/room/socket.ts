// socket.io wiring: "/lobby" (public counts) and "/room" (authenticated play).

import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type { LobbyEventUpdate, PlayerInput, RoomWelcome } from "@owt/shared";
import { prisma } from "../lib/prisma.js";
import type { RoomManager } from "./RoomManager.js";
import type { PlayerLink } from "./Room.js";
import type { JwtUser } from "../plugins/auth.js";

export class LobbyHub {
  constructor(private readonly io: Server, private readonly rooms: RoomManager) {}

  async broadcast(eventId: string): Promise<void> {
    const e = await prisma.weeklyEvent.findUnique({ where: { id: eventId } });
    if (!e) return;
    const registered = await prisma.registration.count({ where: { eventId } });
    const payload: LobbyEventUpdate = { eventId, status: e.status, registered, present: this.rooms.presentCount(eventId) };
    this.io.of("/lobby").emit("lobby:event", payload);
  }
}

class SocketLink implements PlayerLink {
  constructor(private readonly socket: Socket) {}
  send(event: string, payload: unknown) { this.socket.emit(event, payload); }
}

export function attachSockets(app: FastifyInstance, httpServer: HttpServer, rooms: RoomManager, corsOrigins: string[]): { io: Server; lobby: LobbyHub } {
  const io = new Server(httpServer, { cors: { origin: corsOrigins, credentials: true }, path: "/socket.io" });
  const lobby = new LobbyHub(io, rooms);

  io.of("/lobby"); // public, broadcast-only

  const room = io.of("/room");
  room.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
    if (!token) return next(new Error("Not signed in"));
    try {
      socket.data.user = app.jwt.verify<JwtUser>(token);
      next();
    } catch {
      next(new Error("Session expired"));
    }
  });

  room.on("connection", (socket) => {
    const user = socket.data.user as JwtUser;
    const link = new SocketLink(socket);
    let joinedEvent: string | null = null;

    socket.on("room:join", async (p: { eventId: string }, ack: (r: RoomWelcome | { error: string }) => void) => {
      try {
        const eventId = String(p?.eventId ?? "");
        const e = await prisma.weeklyEvent.findUnique({ where: { id: eventId } });
        if (!e) return ack({ error: "No such event" });
        const reg = await prisma.registration.findUnique({ where: { userId_eventId: { userId: user.id, eventId } } });
        joinedEvent = eventId;
        const live = rooms.roomFor(eventId, user.id);
        if (live) {
          const slot = live.attach(user.id, link);
          return ack({ roomId: live.id, eventId, roomIndex: live.index, slot, phase: live.phase, startAt: live.startAt, tick: live.tick, seed: live.seed, roster: live.roster(), engine: live.engineKind, serverTime: Date.now() });
        }
        if (e.status !== "LOBBY" && e.status !== "SCHEDULED") return ack({ error: e.status === "COMPLETE" ? "This event has finished" : "This event is not open" });
        if (!reg) return ack({ error: "Register for this event first" });
        rooms.markPresent(eventId, { userId: user.id, username: user.username, link });
        await lobby.broadcast(eventId);
        return ack({ roomId: "", eventId, roomIndex: -1, slot: -1, phase: "waiting", startAt: e.scheduledAt.getTime(), tick: 0, seed: 0, roster: [], engine: "stub", serverTime: Date.now() });
      } catch (err) {
        app.log.error(err, "room:join failed");
        ack({ error: "Could not join" });
      }
    });

    socket.on("room:input", (p: { input: PlayerInput }) => {
      if (!joinedEvent || !p?.input) return;
      rooms.roomFor(joinedEvent, user.id)?.setInput(user.id, p.input);
    });

    const leave = () => {
      if (!joinedEvent) return;
      rooms.roomFor(joinedEvent, user.id)?.detach(user.id, link);
      rooms.markAbsent(joinedEvent, user.id, link);
      void lobby.broadcast(joinedEvent);
      joinedEvent = null;
    };
    socket.on("room:leave", leave);
    socket.on("disconnect", leave);
  });

  return { io, lobby };
}
