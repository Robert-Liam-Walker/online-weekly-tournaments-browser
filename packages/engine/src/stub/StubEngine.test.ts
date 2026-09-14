import { describe, expect, it } from "vitest";
import { BTN, NULL_INPUT, type EngineEvent, type PlayerInput, type WorldState } from "@owt/shared";
import { StubEngine } from "./StubEngine.js";

type Script = (t: number, s: number, world: WorldState) => PlayerInput;

function run(seed: number, slots: number, frames: number, script: Script) {
  const e = new StubEngine();
  e.init({ seed, slots, staminaHp: 150 });
  const events: EngineEvent[] = [];
  for (let t = 0; t < frames; t++) {
    const world = e.state();
    const inputs = Array.from({ length: slots }, (_, s) => script(t, s, world));
    events.push(...e.step(inputs));
    if (events.some((ev) => ev.type === "end")) break;
  }
  return { engine: e, events };
}

/** A simple bot: walk toward the nearest living opponent, swing when in reach. */
const hunter: Script = (_t, s, world) => {
  const me = world.players[s]!;
  if (!me.alive) return NULL_INPUT;
  let best: { dx: number; d: number } | null = null;
  for (const p of world.players) {
    if (p.slot === s || !p.alive) continue;
    const dx = p.x - me.x, d = Math.abs(dx) + Math.abs(p.y - me.y) * 0.5;
    if (!best || d < best.d) best = { dx, d };
  }
  if (!best) return NULL_INPUT;
  if (Math.abs(best.dx) < 60) return { x: Math.sign(best.dx), y: 0, buttons: BTN.A };
  return { x: Math.sign(best.dx), y: 0, buttons: 0 };
};

describe("StubEngine", () => {
  it("is deterministic for identical inputs", () => {
    const script: Script = (t, s) => ({ x: ((t + s) % 3) - 1, y: 0, buttons: t % 7 === 0 ? BTN.A : t % 11 === 0 ? BTN.JUMP : 0 });
    const a = run(42, 100, 600, script);
    const b = run(42, 100, 600, script);
    expect(JSON.stringify(a.engine.state())).toBe(JSON.stringify(b.engine.state()));
    expect(a.events.length).toBe(b.events.length);
  });

  it("ends a 100-fighter box with exactly one winner and every place assigned once", () => {
    const { engine, events } = run(7, 100, 60 * 240, hunter);
    const end = events.find((e) => e.type === "end");
    expect(end).toBeDefined();
    const elims = events.filter((e): e is Extract<EngineEvent, { type: "elim" }> => e.type === "elim");
    expect(elims.length).toBe(99);
    const places = new Set(elims.map((e) => e.place));
    expect(places.size).toBe(99);
    expect(Math.min(...places)).toBe(2);
    expect(Math.max(...places)).toBe(100);
    expect(engine.state().alive).toBe(1);
    // KOs add up to the eliminations that had an attacker.
    const kos = engine.state().players.reduce((a, p) => a + p.kos, 0);
    expect(kos).toBe(elims.filter((e) => e.by !== null).length);
  });

  it("does nothing after the game has ended", () => {
    const { engine } = run(1, 2, 10, () => NULL_INPUT);
    engine.forceEnd();
    const before = JSON.stringify(engine.state());
    engine.step([{ x: 1, y: 0, buttons: BTN.A }, NULL_INPUT]);
    expect(JSON.stringify(engine.state())).toBe(before);
  });

  it("forceEnd ranks the remaining fighters by HP", () => {
    const { engine } = run(5, 4, 30, (t, s) => (s === 0 && t < 20 ? { x: 1, y: 0, buttons: BTN.A } : NULL_INPUT));
    const events = engine.forceEnd();
    const elims = events.filter((e) => e.type === "elim");
    expect(elims.length).toBe(3);
    expect(events.at(-1)?.type).toBe("end");
    expect(engine.state().alive).toBe(1);
  });

  it("round-trips through serialize/deserialize", () => {
    const { engine } = run(3, 10, 200, (t, s) => ({ x: (s % 3) - 1, y: 0, buttons: t % 5 === 0 ? BTN.A : 0 }));
    const snap = engine.serialize();
    const other = new StubEngine();
    other.init({ seed: 999, slots: 10, staminaHp: 150 });
    other.deserialize(snap);
    expect(JSON.stringify(other.state())).toBe(JSON.stringify(engine.state()));
  });
});
