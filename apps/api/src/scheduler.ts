// Keeps exactly one upcoming weekly event on the books and walks events through
// SCHEDULED -> LOBBY -> LIVE on the clock. Idempotent; safe to run every few seconds.

import { LOBBY_OPEN_MINUTES, nextWeeklyStart, weeklyTitleFor } from "@owt/shared";
import { prisma } from "./lib/prisma.js";
import type { RoomManager } from "./room/RoomManager.js";

export async function schedulerTick(rooms: RoomManager, onEventChange: (eventId: string) => Promise<void>, now: Date = new Date()): Promise<void> {
  // 1. Make sure the next Friday is scheduled.
  const upcoming = await prisma.weeklyEvent.findFirst({ where: { status: { in: ["SCHEDULED", "LOBBY"] }, scheduledAt: { gt: now } } });
  if (!upcoming) {
    const scheduledAt = nextWeeklyStart(now);
    const exists = await prisma.weeklyEvent.findFirst({ where: { scheduledAt } });
    if (!exists) await prisma.weeklyEvent.create({ data: { scheduledAt, title: weeklyTitleFor(scheduledAt) } });
  }

  // 2. Open lobbies.
  const lobbyAt = new Date(now.getTime() + LOBBY_OPEN_MINUTES * 60_000);
  const toLobby = await prisma.weeklyEvent.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: lobbyAt } } });
  for (const e of toLobby) {
    await prisma.weeklyEvent.update({ where: { id: e.id }, data: { status: "LOBBY" } });
    await onEventChange(e.id);
  }

  // 3. Go live.
  const toLive = await prisma.weeklyEvent.findMany({ where: { status: "LOBBY", scheduledAt: { lte: now } } });
  for (const e of toLive) {
    if (!rooms.isLive(e.id)) await rooms.startEvent(e.id);
  }
}

export function startScheduler(rooms: RoomManager, onEventChange: (eventId: string) => Promise<void>, intervalMs: number): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await schedulerTick(rooms, onEventChange); }
    catch (err) { console.error("[scheduler]", err); }
    finally { running = false; }
  };
  void run();
  const t = setInterval(run, intervalMs);
  return () => clearInterval(t);
}
