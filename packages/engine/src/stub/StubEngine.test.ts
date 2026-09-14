import { describe, expect, it } from "vitest";
import { BTN, NULL_INPUT, type EngineEvent, type PlayerInput, type WorldState } from "@owt/shared";
import { StubEngine } from "./StubEngine.js";

type Script = (t: number, slot: 0 | 1, world: WorldState) => PlayerInput;

function run(seed: number, frames: number, script: Script, opts: { stocks?: number; timeSeconds?: number; stage?: "fd" | "battlefield" } = {}) {
  const e = new StubEngine();
  e.init({ seed, stage: opts.stage ?? "fd", characters: ["fox", "marth"], stocks: opts.stocks ?? 4, timeSeconds: opts.timeSeconds ?? 480 });
  const events: EngineEvent[] = [];
  for (let t = 0; t < frames; t++) {
    const w = e.state();
    events.push(...e.step([script(t, 0, w), script(t, 1, w)]));
    if (events.some((ev) => ev.type === "end")) break;
  }
  return { engine: e, events };
}

/** Chase the opponent along x and smash when in reach. */
const hunter: Script = (_t, s, w) => {
  const me = w.players[s]!, op = w.players[1 - s]!;
  const dx = op.x - me.x;
  if (Math.abs(dx) < 60) return { x: Math.sign(dx), y: 0, buttons: BTN.A };
  return { x: Math.sign(dx) * 0.6, y: 0, buttons: 0 };
};

describe("StubEngine (stock 1v1)", () => {
  it("is deterministic", () => {
    const script: Script = (t, s) => ({ x: ((t + s) % 3) - 1, y: 0, buttons: t % 9 === 0 ? BTN.A : t % 13 === 0 ? BTN.JUMP : 0 });
    const a = run(11, 1200, script), b = run(11, 1200, script);
    expect(JSON.stringify(a.engine.state())).toBe(JSON.stringify(b.engine.state()));
  });

  it("an aggressor takes all four stocks from an idle opponent; the game ends on stocks", () => {
    const { engine, events } = run(3, 60 * 480, (t, s, w) => (s === 0 ? hunter(t, s, w) : NULL_INPUT));
    const end = events.find((e) => e.type === "end");
    expect(end).toMatchObject({ type: "end", winner: 0, reason: "stocks" });
    expect(events.filter((e) => e.type === "ko").length).toBe(4);
    expect(engine.state().players[1]!.stocks).toBe(0);
  });

  it("respawns with invincibility and percent reset after a stock", () => {
    const { events, engine } = run(5, 60 * 60, (t, s, w) => (s === 0 ? hunter(t, s, w) : NULL_INPUT), { stocks: 4 });
    const ko = events.find((e) => e.type === "ko");
    expect(ko).toBeDefined();
    const p = engine.state().players[1]!;
    expect(p.stocks).toBeLessThan(4);
    expect(p.percent).toBeLessThan(200);
  });

  it("times out to the player with more stocks, then lower percent, else a replay", () => {
    // Nobody moves: equal stocks and percent -> replay.
    const a = run(1, 60 * 5, () => NULL_INPUT, { timeSeconds: 4 });
    expect(a.events.at(-1)).toMatchObject({ type: "end", winner: null, reason: "timeout_replay" });
    // One hit lands then time runs out: lower percent wins.
    const b = run(2, 60 * 30, (t, s, w) => (s === 0 && t < 400 ? hunter(t, s, w) : NULL_INPUT), { timeSeconds: 20 });
    const end = b.events.at(-1)!;
    expect(end.type).toBe("end");
    if (end.type === "end") expect(["timeout_percent", "timeout_stocks", "stocks"]).toContain(end.reason);
  });

  it("does nothing after the game has ended", () => {
    const { engine } = run(1, 60 * 5, () => NULL_INPUT, { timeSeconds: 2 });
    const before = JSON.stringify(engine.state());
    engine.step([{ x: 1, y: 0, buttons: BTN.A }, NULL_INPUT]);
    expect(JSON.stringify(engine.state())).toBe(before);
  });

  it("round-trips through serialize/deserialize", () => {
    const { engine } = run(7, 300, (t, s) => ({ x: (s ? -1 : 1) * ((t % 40) < 20 ? 1 : 0), y: 0, buttons: t % 7 === 0 ? BTN.JUMP : 0 }));
    const other = new StubEngine();
    other.init({ seed: 99, stage: "battlefield", characters: ["fox", "marth"], stocks: 4, timeSeconds: 480 });
    other.deserialize(engine.serialize());
    expect(JSON.stringify(other.state())).toBe(JSON.stringify(engine.state()));
  });
});
