import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nextWeeklyStart, weeklyTitleFor, type WeeklyEventDto } from "@owt/shared";
import { prisma } from "../lib/prisma.js";
import type { TournamentManager } from "../tournament/TournamentManager.js";
import type { LobbyHub } from "../tournament/socket.js";

export async function toDto(e: { id: string; title: string; scheduledAt: Date; status: string; seedOrder?: string[] }, userId?: string, present = 0): Promise<WeeklyEventDto> {
  const registered = await prisma.registration.count({ where: { eventId: e.id } });
  const isRegistered = userId ? !!(await prisma.registration.findUnique({ where: { userId_eventId: { userId, eventId: e.id } } })) : undefined;
  return { id: e.id, title: e.title, scheduledAt: e.scheduledAt.toISOString(), status: e.status as WeeklyEventDto["status"], registered, checkedIn: present, isRegistered, entrants: e.seedOrder?.length };
}

async function optionalUserId(request: { jwtVerify: <T>() => Promise<T> }): Promise<string | undefined> {
  try { return (await request.jwtVerify<{ id: string }>()).id; } catch { return undefined; }
}

export async function eventRoutes(app: FastifyInstance, deps: { tm: TournamentManager; lobby: LobbyHub }) {
  const { tm, lobby } = deps;

  /** The event players care about right now: LIVE, else LOBBY, else the next SCHEDULED. */
  app.get("/next", async (request) => {
    const userId = await optionalUserId(request);
    const e =
      (await prisma.weeklyEvent.findFirst({ where: { status: { in: ["LIVE", "LOBBY"] } }, orderBy: { scheduledAt: "asc" } })) ??
      (await prisma.weeklyEvent.findFirst({ where: { status: "SCHEDULED" }, orderBy: { scheduledAt: "asc" } }));
    if (!e) return { event: null };
    return { event: await toDto(e, userId, tm.presentCount(e.id)) };
  });

  app.get("/", async (request) => {
    const userId = await optionalUserId(request);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(50).default(12) }).parse(request.query ?? {});
    const list = await prisma.weeklyEvent.findMany({ orderBy: { scheduledAt: "desc" }, take: q.limit });
    return { events: await Promise.all(list.map((e) => toDto(e, userId, tm.presentCount(e.id)))) };
  });

  app.get("/:id", async (request, reply) => {
    const userId = await optionalUserId(request);
    const { id } = request.params as { id: string };
    const e = await prisma.weeklyEvent.findUnique({ where: { id } });
    if (!e) return reply.code(404).send({ error: "No such event" });
    return { event: await toDto(e, userId, tm.presentCount(e.id)) };
  });

  app.get("/:id/entrants", async (request, reply) => {
    const { id } = request.params as { id: string };
    const e = await prisma.weeklyEvent.findUnique({ where: { id } });
    if (!e) return reply.code(404).send({ error: "No such event" });
    const regs = await prisma.registration.findMany({ where: { eventId: id }, include: { user: { select: { id: true, username: true } } }, orderBy: { createdAt: "asc" } });
    const present = tm.presentSet(id);
    return { entrants: regs.map((r) => ({ userId: r.user.id, username: r.user.username, present: present.has(r.user.id) })) };
  });

  app.get("/:id/bracket", async (request, reply) => {
    const { id } = request.params as { id: string };
    const e = await prisma.weeklyEvent.findUnique({ where: { id } });
    if (!e) return reply.code(404).send({ error: "No such event" });
    const bracket = tm.bracketDto(id) ?? (await tm.bracketDtoFromDb(id));
    return { bracket };
  });

  app.post("/:id/register", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const e = await prisma.weeklyEvent.findUnique({ where: { id } });
    if (!e) return reply.code(404).send({ error: "No such event" });
    if (e.status !== "SCHEDULED" && e.status !== "LOBBY") return reply.code(409).send({ error: "Registration is closed" });
    await prisma.registration.upsert({ where: { userId_eventId: { userId: request.user.id, eventId: id } }, create: { userId: request.user.id, eventId: id }, update: {} });
    await lobby.broadcast(id);
    return { event: await toDto(e, request.user.id, tm.presentCount(id)) };
  });

  app.delete("/:id/register", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const e = await prisma.weeklyEvent.findUnique({ where: { id } });
    if (!e) return reply.code(404).send({ error: "No such event" });
    if (e.status === "LIVE" || e.status === "COMPLETE") return reply.code(409).send({ error: "Too late to withdraw" });
    await prisma.registration.deleteMany({ where: { userId: request.user.id, eventId: id } });
    await lobby.broadcast(id);
    return { event: await toDto(e, request.user.id, tm.presentCount(id)) };
  });

  // ---- admin -------------------------------------------------------------

  app.post("/", { preHandler: app.requireAdmin }, async (request, reply) => {
    const body = z.object({ scheduledAt: z.string().datetime().optional(), title: z.string().min(1).max(80).optional() }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "Invalid input" });
    const scheduledAt = body.data.scheduledAt ? new Date(body.data.scheduledAt) : nextWeeklyStart();
    const e = await prisma.weeklyEvent.create({ data: { scheduledAt, title: body.data.title ?? weeklyTitleFor(scheduledAt) } });
    return { event: await toDto(e, request.user.id) };
  });

  /** Force an event to start soon: lobby opens now, bracket draws in one minute. */
  app.post("/:id/start", { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const e = await prisma.weeklyEvent.findUnique({ where: { id } });
    if (!e) return reply.code(404).send({ error: "No such event" });
    if (e.status !== "SCHEDULED" && e.status !== "LOBBY") return reply.code(409).send({ error: `Event is ${e.status}` });
    const scheduledAt = new Date(Date.now() + 60_000);
    await prisma.weeklyEvent.update({ where: { id }, data: { status: "LOBBY", scheduledAt } });
    await lobby.broadcast(id);
    return { ok: true, scheduledAt: scheduledAt.toISOString() };
  });

  app.post("/:id/cancel", { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const e = await prisma.weeklyEvent.findUnique({ where: { id } });
    if (!e) return reply.code(404).send({ error: "No such event" });
    if (e.status === "COMPLETE") return reply.code(409).send({ error: "Already complete" });
    tm.abortEvent(id);
    await prisma.weeklyEvent.update({ where: { id }, data: { status: "CANCELLED", endedAt: new Date() } });
    await lobby.broadcast(id);
    return { ok: true };
  });

  /** TO override: the named player forfeits the live set. */
  app.post("/:id/matches/:key/forfeit", { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id, key } = request.params as { id: string; key: string };
    const body = z.object({ userId: z.string().min(1) }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "userId required" });
    if (!tm.forfeitMatch(id, key, body.data.userId)) return reply.code(409).send({ error: "No such live set for that player" });
    return { ok: true };
  });
}
