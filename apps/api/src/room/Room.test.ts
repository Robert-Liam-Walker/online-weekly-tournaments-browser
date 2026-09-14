import { describe, expect, it } from "vitest";
import { BTN, NULL_INPUT, TICK_RATE, unpackWorld, type PackedWorld, type PlayerInput, type WorldState } from "@owt/shared";
import { StubEngine } from "@owt/engine";
import { Room, type PlayerLink, type RoomFinish } from "./Room.js";

class FakeLink implements PlayerLink {
  events: { event: string; payload: unknown }[] = [];
  send(event: string, payload: unknown) { this.events.push({ event, payload }); }
  count(event: string) { return this.events.filter((e) => e.event === event).length; }
  last<T>(event: string): T | undefined { return this.events.filter((e) => e.event === event).at(-1)?.payload as T | undefined; }
}

function makeRoom(n: number, clock: { t: number }, onFinish: (f: RoomFinish) => void = () => {}) {
  const entrants = Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, username: `player${i}` }));
  return new Room({ id: "r0", eventId: "e0", index: 0, seed: 123, engine: new StubEngine(), entrants, staminaHp: 150, now: () => clock.t, onFinish });
}

/** Same bot as the engine test: chase the nearest opponent, swing in reach. */
function hunt(world: WorldState, s: number): PlayerInput {
  const me = world.players[s]!;
  if (!me.alive) return NULL_INPUT;
  let best: { dx: number; d: number } | null = null;
  for (const p of world.players) {
    if (p.slot === s || !p.alive) continue;
    const dx = p.x - me.x, d = Math.abs(dx) + Math.abs(p.y - me.y) * 0.5;
    if (!best || d < best.d) best = { dx, d };
  }
  if (!best) return NULL_INPUT;
  return { x: Math.sign(best.dx), y: 0, buttons: Math.abs(best.dx) < 60 ? BTN.A : 0 };
}

const FRAME = 1000 / TICK_RATE;

describe("Room", () => {
  it("moves waiting -> countdown -> live on the clock and steps 60 frames per second", () => {
    const clock = { t: 1_000_000 };
    const room = makeRoom(4, clock);
    const link = new FakeLink();
    expect(room.attach("u0", link)).toBe(0);
    expect(room.attach("stranger", new FakeLink())).toBe(-1);

    room.start(3000);
    expect(room.phase).toBe("countdown");
    room.pump();
    expect(room.phase).toBe("countdown");
    clock.t += 3000;
    room.pump();
    expect(room.phase).toBe("live");
    expect(room.tick).toBe(0);

    // One real second, pumped at the 4 ms cadence the manager uses.
    for (let i = 0; i < 250; i++) { clock.t += 4; room.pump(); }
    expect(room.tick).toBe(60);
    expect(link.count("room:snapshot")).toBe(20);

    // A stall drops frames instead of spiralling: at most 10 frames per pump.
    clock.t += 5000;
    room.pump();
    expect(room.tick).toBe(70);
  });

  it("runs a full room to completion, reports a result to every player, and persists placements once", () => {
    const clock = { t: 5_000 };
    const finishes: RoomFinish[] = [];
    const room = makeRoom(8, clock, (f) => finishes.push(f));
    const links = Array.from({ length: 8 }, (_, i) => { const l = new FakeLink(); room.attach(`u${i}`, l); return l; });

    room.start(0);
    clock.t += 1;
    room.pump();
    expect(room.phase).toBe("live");

    let world: WorldState | null = null;
    for (let s = 0; s < 60 * 240 && room.phase === "live"; s++) {
      const snap = links[0]!.last<PackedWorld>("room:snapshot");
      if (snap) world = unpackWorld(snap);
      for (let i = 0; i < 8; i++) room.setInput(`u${i}`, world ? hunt(world, i) : { x: i % 2 ? 1 : -1, y: 0, buttons: 0 });
      clock.t += FRAME;
      room.pump();
    }
    expect(room.phase).toBe("finished");
    expect(finishes.length).toBe(1);
    const f = finishes[0]!;
    expect(f.results.length).toBe(8);
    expect(new Set(f.results.map((r) => r.place)).size).toBe(8);
    const winner = f.results.find((r) => r.place === 1)!;
    expect(winner.points).toBe(100);
    for (const l of links) expect(l.count("room:result")).toBe(1);
    const winnerLink = links[Number(winner.userId.slice(1))]!;
    expect(winnerLink.last<{ place: number }>("room:result")!.place).toBe(1);
    // Eliminated players got their result the moment they went out, not at the end.
    const firstOut = f.results.find((r) => r.place === 8)!;
    const firstOutLink = links[Number(firstOut.userId.slice(1))]!;
    expect(firstOutLink.last<{ place: number }>("room:result")!.place).toBe(8);
  });

  it("ignores input from spectators and before the room is live", () => {
    const clock = { t: 0 };
    const room = makeRoom(2, clock);
    room.setInput("u0", { x: 1, y: 0, buttons: BTN.A }); // waiting: dropped
    room.setInput("nobody", { x: 1, y: 0, buttons: BTN.A });
    room.start(0);
    clock.t += 1; room.pump();
    clock.t += 1000; room.pump();
    expect(room.tick).toBeGreaterThan(0);
  });

  it("a disconnected player keeps their slot with neutral input and can reattach", () => {
    const clock = { t: 0 };
    const room = makeRoom(3, clock);
    const a = new FakeLink();
    room.attach("u1", a);
    room.detach("u1", a);
    expect(room.roster()[1]!.connected).toBe(false);
    const b = new FakeLink();
    expect(room.attach("u1", b)).toBe(1);
    expect(room.roster()[1]!.connected).toBe(true);
  });
});
