import { describe, expect, it } from "vitest";
import { applyAction, counterpickOptions, createSet, forfeit, recordGame, remainingNeutrals, turnOf, type SetState } from "./set.js";
import { NEUTRAL_STAGES } from "./rules.js";

function playGame1(s: SetState, chars: [string, string] = ["fox", "marth"]): SetState {
  const first = s.firstStriker, second = (1 - first) as 0 | 1;
  let r = remainingNeutrals(s);
  s = applyAction(s, first, { type: "strike", stages: [r[0]!] });
  r = remainingNeutrals(s);
  s = applyAction(s, second, { type: "strike", stages: [r[0]!, r[1]!] });
  r = remainingNeutrals(s);
  s = applyAction(s, first, { type: "strike", stages: [r[0]!] });
  expect(s.phase).toBe("blind_pick");
  expect(s.stage).toBe(NEUTRAL_STAGES[4]!.id);
  s = applyAction(s, 0, { type: "blind_pick", char: chars[0] });
  s = applyAction(s, 1, { type: "blind_pick", char: chars[1] });
  expect(s.phase).toBe("ready");
  s = applyAction(s, 0, { type: "ready" });
  s = applyAction(s, 1, { type: "ready" });
  expect(s.phase).toBe("playing");
  return s;
}

describe("set state machine", () => {
  it("runs 1-2-1 striking from the first striker and lands on the last neutral", () => {
    const s = createSet(["a", "b"], "BO3", 1);
    expect(turnOf(s)).toBe(1);
    const t = playGame1(s);
    expect(t.games.length).toBe(0);
    expect(t.gameNumber).toBe(1);
  });

  it("rejects out-of-turn strikes, wrong counts, and struck stages", () => {
    const s = createSet(["a", "b"], "BO3", 0);
    expect(() => applyAction(s, 1, { type: "strike", stages: ["fd"] })).toThrow(/Not your strike/);
    expect(() => applyAction(s, 0, { type: "strike", stages: ["fd", "battlefield"] })).toThrow(/exactly 1/);
    const t = applyAction(s, 0, { type: "strike", stages: ["fd"] });
    expect(() => applyAction(t, 1, { type: "strike", stages: ["fd", "battlefield"] })).toThrow(/not available/);
  });

  it("Bo3: winner bans one, loser counterpicks under DSR, winner then loser pick characters", () => {
    let s = playGame1(createSet(["a", "b"], "BO3", 0));
    s = recordGame(s, 0); // a wins game 1 on yoshis
    expect(s.score).toEqual([1, 0]);
    expect(s.phase).toBe("ban");
    expect(turnOf(s)).toBe(0);
    expect(() => applyAction(s, 1, { type: "ban", stages: ["fd"] })).toThrow(/winner bans/);
    s = applyAction(s, 0, { type: "ban", stages: ["fd"] });
    expect(s.phase).toBe("counterpick");
    expect(turnOf(s)).toBe(1);
    expect(counterpickOptions(s)).not.toContain("fd");
    expect(counterpickOptions(s)).toContain("stadium");
    s = applyAction(s, 1, { type: "pick_stage", stage: "stadium" });
    expect(s.phase).toBe("winner_char");
    s = applyAction(s, 0, { type: "pick_char", char: "falco" });
    expect(s.phase).toBe("loser_char");
    s = applyAction(s, 1, { type: "pick_char", char: "sheik" });
    expect(s.phase).toBe("ready");
    s = applyAction(s, 0, { type: "ready" }); s = applyAction(s, 1, { type: "ready" });
    s = recordGame(s, 1); // b wins on stadium
    expect(s.score).toEqual([1, 1]);
    // Game 3: a lost, a counterpicks; a cannot go back to yoshis (DSR), b bans one more.
    s = applyAction(s, 1, { type: "ban", stages: ["battlefield"] });
    expect(counterpickOptions(s)).not.toContain("yoshis");
    expect(counterpickOptions(s)).not.toContain("battlefield");
    expect(() => applyAction(s, 0, { type: "pick_stage", stage: "yoshis" })).toThrow(/DSR/);
    s = applyAction(s, 0, { type: "pick_stage", stage: "dreamland" });
    s = applyAction(s, 1, { type: "pick_char", char: "sheik" });
    s = applyAction(s, 0, { type: "pick_char", char: "fox" });
    s = applyAction(s, 0, { type: "ready" }); s = applyAction(s, 1, { type: "ready" });
    s = recordGame(s, 0);
    expect(s.phase).toBe("complete");
    expect(s.winner).toBe(0);
    expect(s.games.map((g) => g.stage)).toEqual(["yoshis", "stadium", "dreamland"]);
  });

  it("Bo5 has no bans and needs three wins", () => {
    let s = playGame1(createSet(["a", "b"], "BO5", 0));
    s = recordGame(s, 0);
    expect(s.phase).toBe("counterpick");
    for (let i = 0; i < 2; i++) {
      s = applyAction(s, 1, { type: "pick_stage", stage: counterpickOptions(s)[0]! });
      s = applyAction(s, 0, { type: "pick_char", char: "fox" });
      s = applyAction(s, 1, { type: "pick_char", char: "marth" });
      s = applyAction(s, 0, { type: "ready" }); s = applyAction(s, 1, { type: "ready" });
      s = recordGame(s, 0);
    }
    expect(s.phase).toBe("complete");
    expect(s.score).toEqual([3, 0]);
  });

  it("a dead-even time-out replays the last stock on the same stage", () => {
    let s = playGame1(createSet(["a", "b"], "BO3", 0));
    s = recordGame(s, null);
    expect(s.phase).toBe("ready");
    expect(s.tiebreakPending).toBe(true);
    expect(s.stage).toBe("yoshis");
    s = applyAction(s, 0, { type: "ready" }); s = applyAction(s, 1, { type: "ready" });
    s = recordGame(s, 1);
    expect(s.games[0]!.tiebreak).toBe(true);
    expect(s.tiebreakPending).toBe(false);
    expect(s.score).toEqual([0, 1]);
  });

  it("forfeit ends the set for the other player", () => {
    const s = forfeit(createSet(["a", "b"], "BO3", 0), 1);
    expect(s.phase).toBe("complete");
    expect(s.winner).toBe(0);
  });
});
