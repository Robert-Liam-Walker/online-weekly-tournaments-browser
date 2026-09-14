import { describe, expect, it } from "vitest";
import { BTN, NULL_INPUT, TICK_RATE, remainingNeutrals, type MatchView, type PlayerInput, type SetState, type PackedWorld, unpackWorld, counterpickOptions } from "@owt/shared";
import { StubEngine } from "@owt/engine";
import { MatchRoom, type PlayerLink } from "./MatchRoom.js";

class FakeLink implements PlayerLink {
  events: { event: string; payload: unknown }[] = [];
  send(event: string, payload: unknown) { this.events.push({ event, payload }); }
  view(): MatchView | undefined { return this.events.filter((e) => e.event === "match:view").at(-1)?.payload as MatchView | undefined; }
  count(event: string) { return this.events.filter((e) => e.event === event).length; }
  lastSnapshot() { return this.events.filter((e) => e.event === "match:snapshot").at(-1)?.payload as PackedWorld | undefined; }
}

const FRAME = 1000 / TICK_RATE;

function makeRoom(clock: { t: number }, format: "BO3" | "BO5" = "BO3", onComplete = (_r: unknown) => {}) {
  return new MatchRoom({
    eventId: "e", matchKey: "W1-1", roundLabel: "Winners Round 1", format,
    players: [{ userId: "a", username: "alice" }, { userId: "b", username: "bob" }],
    firstStriker: 0, seed: 42, makeEngine: async () => new StubEngine(), now: () => clock.t, onComplete,
  });
}

async function flush() { await new Promise((r) => setTimeout(r, 0)); }

async function setupGame1(room: MatchRoom) {
  let r = remainingNeutrals(room.set);
  room.action("a", { type: "strike", stages: [r[0]!] });
  r = remainingNeutrals(room.set);
  room.action("b", { type: "strike", stages: [r[0]!, r[1]!] });
  r = remainingNeutrals(room.set);
  room.action("a", { type: "strike", stages: [r[0]!] });
  room.action("a", { type: "blind_pick", char: "fox" });
  room.action("b", { type: "blind_pick", char: "marth" });
  room.action("a", { type: "ready" });
  room.action("b", { type: "ready" });
  await flush();
}

/** Chase and smash; the idle opponent loses every stock. */
function hunt(view: PackedWorld, slot: 0 | 1): PlayerInput {
  const w = unpackWorld(view);
  const me = w.players[slot]!, op = w.players[1 - slot]!;
  const dx = op.x - me.x;
  return Math.abs(dx) < 60 ? { x: Math.sign(dx), y: 0, buttons: BTN.A } : { x: Math.sign(dx) * 0.6, y: 0, buttons: 0 };
}

async function playGame(room: MatchRoom, clock: { t: number }, a: FakeLink, aggressor: "a" | "b") {
  expect(room.phase).toBe("countdown");
  clock.t = room.startAt! + 1;
  room.pump();
  expect(room.phase).toBe("live");
  for (let i = 0; i < 60 * 480 && room.phase === "live"; i++) {
    const snap = a.lastSnapshot();
    if (snap) room.setInput(aggressor, hunt(snap, aggressor === "a" ? 0 : 1));
    clock.t += FRAME;
    room.pump();
  }
  await flush();
}

describe("MatchRoom", () => {
  it("waits for both players, then runs striking, blind picks, ready, countdown and a game", async () => {
    const clock = { t: 1_000_000 };
    const room = makeRoom(clock);
    const a = new FakeLink(), b = new FakeLink();
    expect(room.attach("a", a)).toBe(0);
    expect(room.phase).toBe("waiting");
    expect(() => room.action("a", { type: "strike", stages: ["fd"] })).toThrow(/Waiting/);
    expect(room.attach("b", b)).toBe(1);
    expect(room.phase).toBe("setup");
    expect(a.view()!.waitingOn).toEqual([0]);
    await setupGame1(room);
    expect(room.phase).toBe("countdown");
    expect(a.view()!.set!.stage).toBe("yoshis");
    await playGame(room, clock, a, "a");
    expect(room.set.score).toEqual([1, 0]);
    expect(room.phase).toBe("setup");
    expect(room.set.phase).toBe("ban");
    expect(a.count("match:snapshot")).toBeGreaterThan(20);
  });

  it("plays a full Bo3 to completion with counterpicks and reports the winner once", async () => {
    const clock = { t: 5_000 };
    const results: unknown[] = [];
    const room = makeRoom(clock, "BO3", (r) => results.push(r));
    const a = new FakeLink(), b = new FakeLink();
    room.attach("a", a); room.attach("b", b);
    await setupGame1(room);
    await playGame(room, clock, a, "a");
    // Game 2: a bans, b counterpicks, a picks char, b picks char.
    room.action("a", { type: "ban", stages: ["fd"] });
    room.action("b", { type: "pick_stage", stage: counterpickOptions(room.set)[0]! });
    room.action("a", { type: "pick_char", char: "fox" });
    room.action("b", { type: "pick_char", char: "sheik" });
    room.action("a", { type: "ready" }); room.action("b", { type: "ready" });
    await flush();
    await playGame(room, clock, a, "a");
    expect(room.phase).toBe("complete");
    expect(room.set.winner).toBe(0);
    expect(results.length).toBe(1);
    expect((results[0] as { forfeit: boolean }).forfeit).toBe(false);
    const v = b.view()!;
    expect(v.phase).toBe("complete");
    expect((v.set as SetState).score).toEqual([2, 0]);
  });

  it("forfeits a no-show after the window", async () => {
    const clock = { t: 0 };
    const results: { winnerSlot: number; forfeit: boolean }[] = [];
    const room = makeRoom(clock, "BO3", (r) => results.push(r as { winnerSlot: number; forfeit: boolean }));
    room.attach("a", new FakeLink());
    clock.t += 4 * 60_000; room.pump();
    expect(room.done).toBe(false);
    clock.t += 2 * 60_000; room.pump();
    expect(room.phase).toBe("forfeited");
    expect(results).toEqual([{ winnerSlot: 0, forfeit: true, set: expect.anything() }]);
  });

  it("a player who disconnects mid-set and stays away forfeits; a reconnect cancels the clock", async () => {
    const clock = { t: 0 };
    const room = makeRoom(clock);
    const a = new FakeLink(), b = new FakeLink();
    room.attach("a", a); room.attach("b", b);
    room.detach("b", b);
    expect(a.view()!.noShowDeadline).toBe(3 * 60_000);
    clock.t += 60_000; room.pump();
    room.attach("b", new FakeLink());
    clock.t += 90_000; room.pump();
    expect(room.done).toBe(false);
    room.detach("b", room["links"][1]!);
    clock.t += 3 * 60_000 + 1; room.pump(); // the setup clock pauses while b is away; the disconnect clock does not
    expect(room.phase).toBe("forfeited");
    expect(room.set.winner).toBe(0);
  });

  it("a connected player who ignores a setup step forfeits after two minutes", () => {
    const clock = { t: 0 };
    const room = makeRoom(clock);
    room.attach("a", new FakeLink()); room.attach("b", new FakeLink());
    clock.t += 90_000; room.pump();
    expect(room.done).toBe(false);
    clock.t += 31_000; room.pump();
    expect(room.phase).toBe("forfeited");
    expect(room.set.winner).toBe(1); // a (first striker) never struck
  });

  it("ignores input from spectators and outside live play", () => {
    const clock = { t: 0 };
    const room = makeRoom(clock);
    room.attach("a", new FakeLink()); room.attach("b", new FakeLink());
    expect(room.attach("zed", new FakeLink())).toBe(-1);
    room.setInput("zed", { x: 1, y: 0, buttons: BTN.A });
    room.setInput("a", { x: 1, y: 0, buttons: BTN.A });
    expect(room["inputs"][0]).toEqual(NULL_INPUT);
  });
});
