// Owns every live Room, the pre-start "present" pool per event, and the single
// pump timer. Persists placements when a room finishes and closes the event
// when its last room does.

import { MIN_PLAYERS, ROOM_CAP, START_COUNTDOWN_SECONDS, STAMINA_HP, roomSizes, type Engine } from "@owt/shared";
import { createEngine, EngineNotBuiltError, type EngineKind } from "@owt/engine";
import { prisma } from "../lib/prisma.js";
import { Room, type PlayerLink, type RoomFinish } from "./Room.js";

export interface PresentPlayer {
  userId: string;
  username: string;
  link: PlayerLink;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();            // roomId -> room
  private readonly roomsByEvent = new Map<string, Room[]>();   // eventId -> rooms
  private readonly present = new Map<string, Map<string, PresentPlayer>>(); // eventId -> userId -> player
  private readonly pending = new Map<string, number>();         // eventId -> rooms still running
  private timer: NodeJS.Timeout | null = null;
  private engineWasm: ArrayBuffer | null = null;

  constructor(private readonly engineKind: EngineKind, private readonly onEventChange: (eventId: string) => Promise<void>) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { for (const r of this.rooms.values()) r.pump(); }, 4);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** A registered player opened the arena for this event before it started. */
  markPresent(eventId: string, p: PresentPlayer): void {
    let m = this.present.get(eventId);
    if (!m) { m = new Map(); this.present.set(eventId, m); }
    m.set(p.userId, p);
  }

  markAbsent(eventId: string, userId: string, link: PlayerLink): void {
    const m = this.present.get(eventId);
    if (m && m.get(userId)?.link === link) m.delete(userId);
  }

  presentCount(eventId: string): number {
    const live = this.roomsByEvent.get(eventId);
    if (live) return live.reduce((a, r) => a + r.roster().filter((x) => x.connected).length, 0);
    return this.present.get(eventId)?.size ?? 0;
  }

  presentSet(eventId: string): Set<string> {
    const live = this.roomsByEvent.get(eventId);
    if (live) return new Set(live.flatMap((r) => r.roster().filter((x) => x.connected).map((x) => x.userId)));
    return new Set(this.present.get(eventId)?.keys() ?? []);
  }

  roomFor(eventId: string, userId: string): Room | null {
    const rooms = this.roomsByEvent.get(eventId);
    if (!rooms || rooms.length === 0) return null;
    return rooms.find((r) => r.roster().some((e) => e.userId === userId)) ?? rooms[0] ?? null;
  }

  isLive(eventId: string): boolean { return this.roomsByEvent.has(eventId); }

  /** Partition everyone registered AND present into rooms and start the countdown. */
  async startEvent(eventId: string): Promise<void> {
    if (this.roomsByEvent.has(eventId)) return;
    const regs = await prisma.registration.findMany({ where: { eventId }, include: { user: { select: { id: true, username: true } } } });
    const presentMap = this.present.get(eventId) ?? new Map<string, PresentPlayer>();
    const entrants = regs.filter((r) => presentMap.has(r.userId)).map((r) => ({ userId: r.user.id, username: r.user.username }));

    if (entrants.length < MIN_PLAYERS) {
      // Nobody (or one person) showed up: close the event without placements.
      await prisma.weeklyEvent.update({ where: { id: eventId }, data: { status: "COMPLETE", startedAt: new Date(), endedAt: new Date() } });
      for (const p of presentMap.values()) p.link.send("room:phase", { phase: "voided", startAt: null });
      this.present.delete(eventId);
      await this.onEventChange(eventId);
      return;
    }

    // Seeded shuffle so room assignment is not registration order.
    const seedBase = (Date.now() ^ entrants.length * 2654435761) >>> 0;
    let s = seedBase || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
    for (let i = entrants.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [entrants[i], entrants[j]] = [entrants[j]!, entrants[i]!]; }

    const sizes = roomSizes(entrants.length, ROOM_CAP);
    const rooms: Room[] = [];
    let offset = 0;
    for (let i = 0; i < sizes.length; i++) {
      const slice = entrants.slice(offset, offset + sizes[i]!);
      offset += sizes[i]!;
      const room = new Room({
        id: `${eventId}:${i}`, eventId, index: i, seed: (seedBase + i * 7919) >>> 0,
        engine: await this.makeEngine(), entrants: slice, staminaHp: STAMINA_HP,
        onFinish: (f) => void this.persistFinish(eventId, f),
      });
      for (const e of slice) { const p = presentMap.get(e.userId); if (p) room.attach(e.userId, p.link); }
      rooms.push(room);
      this.rooms.set(room.id, room);
    }
    this.roomsByEvent.set(eventId, rooms);
    this.pending.set(eventId, rooms.length);
    this.present.delete(eventId);

    await prisma.weeklyEvent.update({ where: { id: eventId }, data: { status: "LIVE", startedAt: new Date() } });
    for (const r of rooms) r.start(START_COUNTDOWN_SECONDS * 1000);
    // Let each connected player learn which room they landed in.
    for (const r of rooms) for (const e of r.roster()) {
      const p = presentMap.get(e.userId);
      p?.link.send("room:assigned", { roomId: r.id, roomIndex: r.index, slot: e.slot, startAt: r.startAt, seed: r.seed, roster: r.roster(), engine: r.engineKind });
    }
    await this.onEventChange(eventId);
  }

  abortEvent(eventId: string): void {
    for (const r of this.roomsByEvent.get(eventId) ?? []) { r.void(); this.rooms.delete(r.id); }
    this.roomsByEvent.delete(eventId);
    this.pending.delete(eventId);
    for (const p of this.present.get(eventId)?.values() ?? []) p.link.send("room:phase", { phase: "voided", startAt: null });
    this.present.delete(eventId);
  }

  private async makeEngine(): Promise<Engine> {
    if (this.engineKind === "wasm") {
      try {
        if (!this.engineWasm) {
          const fs = await import("node:fs/promises");
          const url = new URL("../../../../packages/engine/wasm/engine.wasm", import.meta.url);
          const buf = await fs.readFile(url);
          this.engineWasm = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        }
        return await createEngine("wasm", this.engineWasm);
      } catch (err) {
        if (!(err instanceof EngineNotBuiltError) && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        console.warn("[rooms] wasm engine not built; using the stub engine");
      }
    }
    return createEngine("stub");
  }

  private async persistFinish(eventId: string, f: RoomFinish): Promise<void> {
    try {
      await prisma.placement.createMany({
        data: f.results.map((r) => ({ eventId, userId: r.userId, roomIndex: f.roomIndex, place: r.place, entrants: f.entrants, kos: r.kos, points: r.points })),
        skipDuplicates: true,
      });
    } catch (err) {
      console.error("[rooms] failed to persist placements", err);
    }
    const left = (this.pending.get(eventId) ?? 1) - 1;
    this.pending.set(eventId, left);
    if (left <= 0) {
      await prisma.weeklyEvent.update({ where: { id: eventId }, data: { status: "COMPLETE", endedAt: new Date() } });
      // Keep finished rooms around briefly so late "result" reads still work, then drop them.
      setTimeout(() => {
        for (const r of this.roomsByEvent.get(eventId) ?? []) this.rooms.delete(r.id);
        this.roomsByEvent.delete(eventId);
        this.pending.delete(eventId);
      }, 60_000).unref();
      await this.onEventChange(eventId);
    }
  }
}
