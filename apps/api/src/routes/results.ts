import type { FastifyInstance } from "fastify";
import type { LeaderboardRow, PlacementDto } from "@owt/shared";
import { prisma } from "../lib/prisma.js";

export async function resultRoutes(app: FastifyInstance) {
  app.get("/events/:id/results", async (request, reply) => {
    const { id } = request.params as { id: string };
    const e = await prisma.weeklyEvent.findUnique({ where: { id } });
    if (!e) return reply.code(404).send({ error: "No such event" });
    const rows = await prisma.placement.findMany({ where: { eventId: id }, include: { user: { select: { id: true, username: true } } }, orderBy: [{ place: "asc" }, { points: "desc" }] });
    const placements: PlacementDto[] = rows.map((r) => ({ userId: r.user.id, username: r.user.username, place: r.place, setsWon: r.setsWon, setsLost: r.setsLost, points: r.points }));
    return { event: { id: e.id, title: e.title, scheduledAt: e.scheduledAt.toISOString(), status: e.status, entrants: e.seedOrder.length }, placements };
  });

  app.get("/leaderboard", async () => {
    const grouped = await prisma.placement.groupBy({ by: ["userId"], _sum: { points: true }, _count: { _all: true }, _min: { place: true }, orderBy: { _sum: { points: "desc" } }, take: 100 });
    const ids = grouped.map((g) => g.userId);
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } });
    const wins = await prisma.placement.groupBy({ by: ["userId"], where: { userId: { in: ids }, place: 1 }, _count: { _all: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.username]));
    const winsOf = new Map(wins.map((w) => [w.userId, w._count._all]));
    const rows: LeaderboardRow[] = grouped.map((g) => ({ userId: g.userId, username: nameOf.get(g.userId) ?? "?", points: g._sum.points ?? 0, events: g._count._all, wins: winsOf.get(g.userId) ?? 0, bestPlace: g._min.place ?? 0 }));
    return { rows };
  });

  app.get("/users/:username/results", async (request, reply) => {
    const { username } = request.params as { username: string };
    const user = await prisma.user.findFirst({ where: { username: { equals: username, mode: "insensitive" } }, select: { id: true, username: true, createdAt: true } });
    if (!user) return reply.code(404).send({ error: "No such player" });
    const rows = await prisma.placement.findMany({ where: { userId: user.id }, include: { event: { select: { id: true, title: true, scheduledAt: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
    return {
      user: { id: user.id, username: user.username, createdAt: user.createdAt.toISOString() },
      results: rows.map((r) => ({ eventId: r.event.id, title: r.event.title, scheduledAt: r.event.scheduledAt.toISOString(), place: r.place, entrants: r.entrants, setsWon: r.setsWon, setsLost: r.setsLost, points: r.points })),
      totalPoints: rows.reduce((a, r) => a + r.points, 0),
    };
  });
}
