// Runs every live weekly: draws the bracket from whoever is registered and
// present, opens a MatchRoom for each playable set, reports results into the
// bracket as sets finish, persists everything so a restart can rebuild, and
// closes the event with placements and points.

import {
  MIN_ENTRANTS, formatForMatch, generateDoubleElim, getChampion, getPlacements, getReadyMatches, isComplete, placementPoints, reportResult,
  type BracketDto, type BracketMatchDto, type DEBracket, type Engine, type GameRecord, type MatchState,
} from "@owt/shared";
import { createEngine, EngineNotBuiltError, type EngineKind } from "@owt/engine";
import { prisma } from "../lib/prisma.js";
import { MatchRoom, type PlayerLink } from "./MatchRoom.js";

export interface PresentPlayer { userId: string; username: string; link: PlayerLink }

interface LiveEvent {
  bracket: DEBracket;
  names: Map<string, string>;
  rooms: Map<string, MatchRoom>;   // matchKey -> room
  forfeits: Set<string>;           // matchKeys decided by forfeit
  games: Map<string, GameRecord[]>;
  scores: Map<string, [number, number]>;
}

export function roundLabel(side: "W" | "L" | "GF" | "GFR", round: number, size: number): string {
  const k = Math.log2(size);
  if (side === "GF") return "Grand Finals";
  if (side === "GFR") return "Grand Finals (reset)";
  if (side === "W") return round === k ? "Winners Finals" : round === k - 1 ? "Winners Semis" : `Winners Round ${round}`;
  const last = 2 * k - 2;
  return round === last ? "Losers Finals" : round === last - 1 ? "Losers Semis" : `Losers Round ${round}`;
}

export class TournamentManager {
  private readonly live = new Map<string, LiveEvent>();
  private readonly present = new Map<string, Map<string, PresentPlayer>>();
  private timer: NodeJS.Timeout | null = null;
  private engineWasm: ArrayBuffer | null = null;

  constructor(
    private readonly engineKind: EngineKind,
    private readonly onEventChange: (eventId: string) => Promise<void>,
    private readonly onBracketChange: (eventId: string) => void,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { for (const ev of this.live.values()) for (const r of ev.rooms.values()) r.pump(); }, 4);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  // ---- presence ----------------------------------------------------------

  markPresent(eventId: string, p: PresentPlayer): void {
    let m = this.present.get(eventId);
    if (!m) { m = new Map(); this.present.set(eventId, m); }
    m.set(p.userId, p);
  }

  markAbsent(eventId: string, userId: string, link: PlayerLink): void {
    const m = this.present.get(eventId);
    if (m && m.get(userId)?.link === link) m.delete(userId);
  }

  presentCount(eventId: string): number { return this.present.get(eventId)?.size ?? 0; }
  presentSet(eventId: string): Set<string> { return new Set(this.present.get(eventId)?.keys() ?? []); }
  isLive(eventId: string): boolean { return this.live.has(eventId); }

  /** The unfinished room this user is playing in, if any. */
  roomFor(eventId: string, userId: string): MatchRoom | null {
    const ev = this.live.get(eventId);
    if (!ev) return null;
    for (const r of ev.rooms.values()) if (!r.done && r.slotOf(userId) !== -1) return r;
    return null;
  }

  roomByKey(eventId: string, matchKey: string): MatchRoom | null {
    return this.live.get(eventId)?.rooms.get(matchKey) ?? null;
  }

  /** Whether this user is still alive in the bracket (has a future or current match). */
  isEliminated(eventId: string, userId: string): boolean | null {
    const ev = this.live.get(eventId);
    if (!ev) return null;
    for (const m of ev.bracket.matches.values()) {
      if (m.cancelled) continue;
      if (!m.done && (m.p1 === userId || m.p2 === userId || m.p1 === undefined || m.p2 === undefined)) {
        // an undecided slot might still resolve to this user
        if (m.p1 === userId || m.p2 === userId) return false;
      }
    }
    for (const m of ev.bracket.matches.values()) if (!m.done && !m.cancelled && (m.p1 === undefined || m.p2 === undefined)) {
      if (this.couldFeed(ev.bracket, m, userId)) return false;
    }
    return true;
  }

  private couldFeed(b: DEBracket, m: MatchState, userId: string): boolean {
    for (const src of [m.def.p1, m.def.p2]) {
      if (src.type === "seed") continue;
      const dep = b.matches.get(src.matchKey);
      if (!dep) continue;
      if (!dep.done) {
        if (dep.p1 === userId || dep.p2 === userId) return true;
        if (this.couldFeed(b, dep, userId)) return true;
      }
    }
    return false;
  }

  // ---- lifecycle ---------------------------------------------------------

  /** Draw the bracket from registered + present players, seeded by season points. */
  async startEvent(eventId: string): Promise<void> {
    if (this.live.has(eventId)) return;
    const regs = await prisma.registration.findMany({ where: { eventId }, include: { user: { select: { id: true, username: true } } } });
    const presentMap = this.present.get(eventId) ?? new Map<string, PresentPlayer>();
    const entrants = regs.filter((r) => presentMap.has(r.userId)).map((r) => ({ userId: r.user.id, username: r.user.username }));

    if (entrants.length < MIN_ENTRANTS) {
      await prisma.weeklyEvent.update({ where: { id: eventId }, data: { status: "COMPLETE", startedAt: new Date(), endedAt: new Date() } });
      this.present.delete(eventId);
      await this.onEventChange(eventId);
      return;
    }

    // Seed by season points (desc), ties broken by a seeded shuffle.
    const pts = await prisma.placement.groupBy({ by: ["userId"], where: { userId: { in: entrants.map((e) => e.userId) } }, _sum: { points: true } });
    const pointsOf = new Map(pts.map((p) => [p.userId, p._sum.points ?? 0]));
    let s = (Date.now() ^ (entrants.length * 2654435761)) >>> 0 || 1;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
    const shuffled = [...entrants];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]; }
    shuffled.sort((a, b) => (pointsOf.get(b.userId) ?? 0) - (pointsOf.get(a.userId) ?? 0));
    const seedOrder = shuffled.map((e) => e.userId);

    const bracket = generateDoubleElim(seedOrder);
    const ev: LiveEvent = { bracket, names: new Map(entrants.map((e) => [e.userId, e.username])), rooms: new Map(), forfeits: new Set(), games: new Map(), scores: new Map() };
    this.live.set(eventId, ev);
    this.present.delete(eventId);

    await prisma.weeklyEvent.update({ where: { id: eventId }, data: { status: "LIVE", startedAt: new Date(), seedOrder } });
    await prisma.tournamentMatch.createMany({
      data: [...bracket.matches.values()].map((m) => ({ eventId, matchKey: m.def.key, p1Id: m.p1 ?? null, p2Id: m.p2 ?? null, status: m.done ? "DONE" : "PENDING", winnerId: m.winnerId })),
      skipDuplicates: true,
    });
    this.openReadyRooms(eventId, ev, presentMap);
    await this.onEventChange(eventId);
    this.onBracketChange(eventId);
  }

  /** Rebuild a LIVE event after a restart from its persisted results; unfinished sets restart. */
  async restoreEvent(eventId: string): Promise<void> {
    const e = await prisma.weeklyEvent.findUnique({ where: { id: eventId }, include: { matches: true } });
    if (!e || e.status !== "LIVE" || e.seedOrder.length < 2 || this.live.has(eventId)) return;
    const users = await prisma.user.findMany({ where: { id: { in: e.seedOrder } }, select: { id: true, username: true } });
    const bracket = generateDoubleElim(e.seedOrder);
    const ev: LiveEvent = { bracket, names: new Map(users.map((u) => [u.id, u.username])), rooms: new Map(), forfeits: new Set(), games: new Map(), scores: new Map() };
    // Replay results in bracket order (winners first, then by round) until nothing more applies.
    const done = e.matches.filter((m) => m.status === "DONE" && m.winnerId);
    let progress = true;
    const applied = new Set<string>();
    while (progress) {
      progress = false;
      for (const m of done) {
        if (applied.has(m.matchKey)) continue;
        const bm = bracket.matches.get(m.matchKey);
        if (!bm || bm.done || bm.p1 == null || bm.p2 == null) continue;
        reportResult(bracket, m.matchKey, m.winnerId!);
        applied.add(m.matchKey);
        if (m.forfeit) ev.forfeits.add(m.matchKey);
        ev.games.set(m.matchKey, (m.games as unknown as GameRecord[]) ?? []);
        ev.scores.set(m.matchKey, [m.score1, m.score2]);
        progress = true;
      }
    }
    this.live.set(eventId, ev);
    if (isComplete(bracket)) { await this.finishEvent(eventId, ev); return; }
    this.openReadyRooms(eventId, ev, new Map());
    this.onBracketChange(eventId);
  }

  abortEvent(eventId: string): void {
    const ev = this.live.get(eventId);
    if (ev) for (const r of ev.rooms.values()) if (!r.done) r.forfeitSlot(1);
    this.live.delete(eventId);
    this.present.delete(eventId);
  }

  /** TO override: decide a live set now. */
  forfeitMatch(eventId: string, matchKey: string, loserId: string): boolean {
    const room = this.roomByKey(eventId, matchKey);
    if (!room || room.done) return false;
    const slot = room.slotOf(loserId);
    if (slot === -1) return false;
    room.forfeitSlot(slot);
    return true;
  }

  private openReadyRooms(eventId: string, ev: LiveEvent, presentMap: Map<string, PresentPlayer>): void {
    for (const m of getReadyMatches(ev.bracket)) {
      if (ev.rooms.has(m.def.key)) continue;
      const p1 = m.p1!, p2 = m.p2!;
      const format = formatForMatch(m.def.side, m.def.round, ev.bracket.size);
      const room = new MatchRoom({
        eventId, matchKey: m.def.key, roundLabel: roundLabel(m.def.side, m.def.round, ev.bracket.size), format,
        players: [{ userId: p1, username: ev.names.get(p1) ?? "?" }, { userId: p2, username: ev.names.get(p2) ?? "?" }],
        firstStriker: (Math.random() < 0.5 ? 0 : 1),
        seed: (Date.now() ^ m.def.key.length * 7919) >>> 0,
        makeEngine: () => this.makeEngine(),
        onComplete: (r) => void this.onSetComplete(eventId, m.def.key, r.winnerSlot, r.forfeit),
        onChange: () => this.onBracketChange(eventId),
      });
      ev.rooms.set(m.def.key, room);
      for (const [slot, uid] of [[0, p1], [1, p2]] as const) {
        const p = presentMap.get(uid) ?? this.lastLinks.get(uid);
        if (p) { room.attach(uid, p.link); this.lastLinks.set(uid, p); void slot; }
      }
      void prisma.tournamentMatch.update({ where: { eventId_matchKey: { eventId, matchKey: m.def.key } }, data: { p1Id: p1, p2Id: p2, status: "LIVE" } }).catch(() => {});
    }
  }

  /** Remember each player's latest link so a new match can attach them without a rejoin. */
  private readonly lastLinks = new Map<string, PresentPlayer>();
  rememberLink(p: PresentPlayer): void { this.lastLinks.set(p.userId, p); }
  forgetLink(userId: string, link: PlayerLink): void { if (this.lastLinks.get(userId)?.link === link) this.lastLinks.delete(userId); }

  private async onSetComplete(eventId: string, matchKey: string, winnerSlot: 0 | 1, wasForfeit: boolean): Promise<void> {
    const ev = this.live.get(eventId);
    if (!ev) return;
    const room = ev.rooms.get(matchKey);
    if (!room) return;
    const winnerId = room.players[winnerSlot].userId;
    try {
      reportResult(ev.bracket, matchKey, winnerId);
    } catch (err) {
      console.error("[tournament] reportResult failed", err);
      return;
    }
    if (wasForfeit) ev.forfeits.add(matchKey);
    ev.games.set(matchKey, room.set.games);
    ev.scores.set(matchKey, room.set.score);
    await prisma.tournamentMatch.update({
      where: { eventId_matchKey: { eventId, matchKey } },
      data: { status: "DONE", winnerId, score1: room.set.score[0], score2: room.set.score[1], games: room.set.games as object[], forfeit: wasForfeit },
    }).catch((err) => console.error("[tournament] persist match failed", err));
    // Sync any slots the bracket just resolved.
    for (const m of ev.bracket.matches.values()) if (!m.done && m.p1 != null && m.p2 != null && !ev.rooms.has(m.def.key)) {
      await prisma.tournamentMatch.update({ where: { eventId_matchKey: { eventId, matchKey: m.def.key } }, data: { p1Id: m.p1, p2Id: m.p2 } }).catch(() => {});
    }
    // Bye-completed matches (a forfeit cascade) need their DONE rows too.
    for (const m of ev.bracket.matches.values()) if (m.done && m.loserId === null) {
      await prisma.tournamentMatch.update({ where: { eventId_matchKey: { eventId, matchKey: m.def.key } }, data: { status: "DONE", winnerId: m.winnerId, p1Id: m.p1 ?? null, p2Id: m.p2 ?? null } }).catch(() => {});
    }
    if (isComplete(ev.bracket)) await this.finishEvent(eventId, ev);
    else this.openReadyRooms(eventId, ev, new Map());
    this.onBracketChange(eventId);
  }

  private async finishEvent(eventId: string, ev: LiveEvent): Promise<void> {
    const placements = getPlacements(ev.bracket);
    const entrants = ev.bracket.players.length;
    const wins = new Map<string, number>(), losses = new Map<string, number>();
    for (const m of ev.bracket.matches.values()) {
      if (!m.done || !m.winnerId || !m.loserId) continue;
      wins.set(m.winnerId, (wins.get(m.winnerId) ?? 0) + 1);
      losses.set(m.loserId, (losses.get(m.loserId) ?? 0) + 1);
    }
    await prisma.placement.createMany({
      data: placements.map((p) => ({ eventId, userId: p.playerId, place: p.placement, entrants, setsWon: wins.get(p.playerId) ?? 0, setsLost: losses.get(p.playerId) ?? 0, points: placementPoints(p.placement, entrants) })),
      skipDuplicates: true,
    }).catch((err) => console.error("[tournament] persist placements failed", err));
    await prisma.weeklyEvent.update({ where: { id: eventId }, data: { status: "COMPLETE", endedAt: new Date() } });
    setTimeout(() => this.live.delete(eventId), 120_000).unref();
    await this.onEventChange(eventId);
    this.onBracketChange(eventId);
  }

  // ---- read model --------------------------------------------------------

  bracketDto(eventId: string): BracketDto | null {
    const ev = this.live.get(eventId);
    if (!ev) return null;
    const matches: BracketMatchDto[] = [...ev.bracket.matches.values()].map((m) => {
      const room = ev.rooms.get(m.def.key);
      return {
        key: m.def.key, side: m.def.side, round: m.def.round, matchNumber: m.def.matchNumber,
        format: formatForMatch(m.def.side, m.def.round, ev.bracket.size),
        p1: m.p1, p2: m.p2, winnerId: m.winnerId,
        score: room ? room.set.score : ev.scores.get(m.def.key) ?? [0, 0],
        games: room ? room.set.games : ev.games.get(m.def.key) ?? [],
        done: m.done, cancelled: m.cancelled, live: !!room && !room.done, forfeit: ev.forfeits.has(m.def.key),
      };
    });
    return {
      eventId, size: ev.bracket.size,
      players: ev.bracket.players.map((id, i) => ({ userId: id, username: ev.names.get(id) ?? "?", seed: i + 1 })),
      matches, champion: getChampion(ev.bracket),
    };
  }

  /** Persisted view for finished events. */
  async bracketDtoFromDb(eventId: string): Promise<BracketDto | null> {
    const e = await prisma.weeklyEvent.findUnique({ where: { id: eventId }, include: { matches: true } });
    if (!e || e.seedOrder.length < 2) return null;
    const users = await prisma.user.findMany({ where: { id: { in: e.seedOrder } }, select: { id: true, username: true } });
    const names = new Map(users.map((u) => [u.id, u.username]));
    const bracket = generateDoubleElim(e.seedOrder);
    const rows = new Map(e.matches.map((m) => [m.matchKey, m]));
    let progress = true;
    const applied = new Set<string>();
    while (progress) {
      progress = false;
      for (const m of e.matches) {
        if (applied.has(m.matchKey) || m.status !== "DONE" || !m.winnerId) continue;
        const bm = bracket.matches.get(m.matchKey);
        if (!bm || bm.done || bm.p1 == null || bm.p2 == null) continue;
        reportResult(bracket, m.matchKey, m.winnerId);
        applied.add(m.matchKey); progress = true;
      }
    }
    const matches: BracketMatchDto[] = [...bracket.matches.values()].map((m) => {
      const row = rows.get(m.def.key);
      return {
        key: m.def.key, side: m.def.side, round: m.def.round, matchNumber: m.def.matchNumber,
        format: formatForMatch(m.def.side, m.def.round, bracket.size),
        p1: m.p1, p2: m.p2, winnerId: m.winnerId, score: [row?.score1 ?? 0, row?.score2 ?? 0], games: (row?.games as unknown as GameRecord[]) ?? [],
        done: m.done, cancelled: m.cancelled, live: false, forfeit: row?.forfeit ?? false,
      };
    });
    return { eventId, size: bracket.size, players: bracket.players.map((id, i) => ({ userId: id, username: names.get(id) ?? "?", seed: i + 1 })), matches, champion: isComplete(bracket) ? getChampion(bracket) : null };
  }

  private async makeEngine(): Promise<Engine> {
    if (this.engineKind === "wasm") {
      try {
        if (!this.engineWasm) {
          const fs = await import("node:fs/promises");
          const buf = await fs.readFile(new URL("../../../../packages/engine/wasm/engine.wasm", import.meta.url));
          this.engineWasm = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        }
        return await createEngine("wasm", this.engineWasm);
      } catch (err) {
        if (!(err instanceof EngineNotBuiltError) && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        console.warn("[tournament] wasm engine not built; using the stub engine");
      }
    }
    return createEngine("stub");
  }
}
