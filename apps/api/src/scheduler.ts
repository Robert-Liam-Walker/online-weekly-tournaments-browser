// Keeps exactly one upcoming weekly on the books and walks events through
// SCHEDULED -> LOBBY -> LIVE on the clock. Idempotent; safe to run every few seconds.

import { LOBBY_OPEN_MINUTES, nextWeeklyStart, weeklyTitleFor } from "@owt/shared";
import { prisma } from "./lib/prisma.js";
import type { TournamentManager } from "./tournament/TournamentManager.js";

export async function schedulerTick(tm: TournamentManager, onEventChange: (eventId: string) => Promise<void>, now: Date = new Date()): Promise<void> {
  const upcoming = await prisma.weeklyEvent.findFirst({ where: { status: { in: ["SCHEDULED", "LOBBY"] }, scheduledAt: { gt: now } } });
  if (!upcoming) {
    const scheduledAt = nextWeeklyStart(now);
    const exists = await prisma.weeklyEvent.findFirst({ where: { scheduledAt } });
    if (!exists) await prisma.weeklyEvent.create({ data: { scheduledAt, title: weeklyTitleFor(scheduledAt) } });
  }

  const lobbyAt = new Date(now.getTime() + LOBBY_OPEN_MINUTES * 60_000);
  for (const e of await prisma.weeklyEvent.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: lobbyAt } } })) {
    await prisma.weeklyEvent.update({ where: { id: e.id }, data: { status: "LOBBY" } });
    await onEventChange(e.id);
  }

  for (const e of await prisma.weeklyEvent.findMany({ where: { status: "LOBBY", scheduledAt: { lte: now } } })) {
    if (!tm.isLive(e.id)) await tm.startEvent(e.id);
  }

  // After a restart, pick live brackets back up from their persisted results.
  for (const e of await prisma.weeklyEvent.findMany({ where: { status: "LIVE" } })) {
    if (!tm.isLive(e.id)) await tm.restoreEvent(e.id);
  }
}

export function startScheduler(tm: TournamentManager, onEventChange: (eventId: string) => Promise<void>, intervalMs: number): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await schedulerTick(tm, onEventChange); }
    catch (err) { console.error("[scheduler]", err); }
    finally { running = false; }
  };
  void run();
  const t = setInterval(run, intervalMs);
  return () => clearInterval(t);
}
