import { describe, expect, it } from "vitest";
import { counterpickAllowed, formatForMatch, placementPoints, timeoutWinner, winnerBanCount, LEGAL_STAGES, NEUTRAL_STAGES, STRIKE_ORDER } from "./rules.js";
import { nextWeeklyStart, WEEKLY_TIME_ZONE } from "./schedule.js";

describe("ruleset data", () => {
  it("has five neutrals plus Stadium, and 1-2-1 striking leaves exactly one", () => {
    expect(NEUTRAL_STAGES.map((s) => s.name)).toEqual(["Battlefield", "Dream Land N64", "Final Destination", "Fountain of Dreams", "Yoshi's Story"]);
    expect(LEGAL_STAGES.length).toBe(6);
    expect(STRIKE_ORDER.reduce((a, [, n]) => a + n, 0)).toBe(NEUTRAL_STAGES.length - 1);
  });
  it("Bo5 for winners final, losers final, grand finals; Bo3 elsewhere; bans only in Bo3", () => {
    expect(formatForMatch("W", 1, 16)).toBe("BO3");
    expect(formatForMatch("W", 4, 16)).toBe("BO5");
    expect(formatForMatch("L", 5, 16)).toBe("BO3");
    expect(formatForMatch("L", 6, 16)).toBe("BO5");
    expect(formatForMatch("GF", 1, 16)).toBe("BO5");
    expect(winnerBanCount("BO3")).toBe(1);
    expect(winnerBanCount("BO5")).toBe(0);
  });
  it("DSR and bans restrict counterpicks", () => {
    expect(counterpickAllowed("fd", ["fd"], [])).toBe(false);
    expect(counterpickAllowed("fd", [], ["fd"])).toBe(false);
    expect(counterpickAllowed("stadium", ["fd"], ["battlefield"])).toBe(true);
  });
  it("time-out: stocks, then percent, then replay", () => {
    expect(timeoutWinner([{ stocks: 2, percent: 100 }, { stocks: 1, percent: 0 }])).toBe(0);
    expect(timeoutWinner([{ stocks: 1, percent: 80 }, { stocks: 1, percent: 40 }])).toBe(1);
    expect(timeoutWinner([{ stocks: 1, percent: 40 }, { stocks: 1, percent: 40 }])).toBe(null);
  });
});

describe("placementPoints", () => {
  it("winner takes 100, last place takes at least 1, monotonic", () => {
    expect(placementPoints(1, 32)).toBe(100);
    expect(placementPoints(32, 32)).toBe(1);
    let prev = Infinity;
    for (let p = 1; p <= 32; p++) { const v = placementPoints(p, 32); expect(v).toBeLessThanOrEqual(prev); prev = v; }
    expect(placementPoints(0, 10)).toBe(0);
  });
});

describe("nextWeeklyStart", () => {
  const wall = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: WEEKLY_TIME_ZONE, weekday: "short", hour: "2-digit", hourCycle: "h23" }).format(d);
  it("lands on a Friday at 20:00 Eastern, strictly in the future", () => {
    for (const iso of ["2026-09-14T12:00:00Z", "2026-09-18T23:59:00Z", "2026-09-19T00:00:01Z", "2026-03-08T12:00:00Z", "2026-11-01T12:00:00Z"]) {
      const now = new Date(iso);
      const next = nextWeeklyStart(now);
      expect(next.getTime()).toBeGreaterThan(now.getTime());
      expect(wall(next)).toMatch(/^Fri.*20$/);
      expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);
    }
  });
});
