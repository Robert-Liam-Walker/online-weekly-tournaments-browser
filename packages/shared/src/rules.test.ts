import { describe, expect, it } from "vitest";
import { placementPoints, roomSizes, ROOM_CAP } from "./rules.js";
import { nextWeeklyStart, WEEKLY_TIME_ZONE } from "./schedule.js";

describe("placementPoints", () => {
  it("winner takes 100, last place takes 1", () => {
    expect(placementPoints(1, 100)).toBe(100);
    expect(placementPoints(100, 100)).toBe(1);
  });
  it("is monotonic in place", () => {
    let prev = Infinity;
    for (let p = 1; p <= 100; p++) {
      const v = placementPoints(p, 100);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
  it("rewards outlasting a bigger field", () => {
    expect(placementPoints(3, 100)).toBeGreaterThan(placementPoints(3, 4));
  });
  it("rejects nonsense", () => {
    expect(placementPoints(0, 10)).toBe(0);
    expect(placementPoints(11, 10)).toBe(0);
  });
});

describe("roomSizes", () => {
  it("fits everyone under the cap", () => {
    for (const n of [1, 2, 99, 100, 101, 150, 250, 1000]) {
      const rooms = roomSizes(n);
      expect(rooms.reduce((a, b) => a + b, 0)).toBe(n);
      for (const r of rooms) expect(r).toBeLessThanOrEqual(ROOM_CAP);
      expect(Math.max(...rooms) - Math.min(...rooms)).toBeLessThanOrEqual(1);
    }
    expect(roomSizes(0)).toEqual([]);
  });
});

describe("nextWeeklyStart", () => {
  const wall = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: WEEKLY_TIME_ZONE, weekday: "short", hour: "2-digit", hourCycle: "h23" }).format(d);
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
