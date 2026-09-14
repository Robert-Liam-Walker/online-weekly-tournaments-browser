// Tournament rules for the browser royale. Pure constants + pure functions; no IO.

/** Max fighters in one box. Events with more entrants split into parallel rooms. */
export const ROOM_CAP = 100;
/** Minimum connected entrants for a room to start; below this the room is voided. */
export const MIN_PLAYERS = 2;
/** Stamina mode: every fighter starts at this HP and is eliminated at 0. */
export const STAMINA_HP = 150;
/** Simulation rate (frames per second). Melee runs at 60. */
export const TICK_RATE = 60;
/** Snapshot broadcast rate from the room server (per second). */
export const SNAPSHOT_RATE = 20;
/** Lobby opens this many minutes before the scheduled start. */
export const LOBBY_OPEN_MINUTES = 15;
/** Seconds between "room is live" and the first frame (players see a countdown). */
export const START_COUNTDOWN_SECONDS = 10;
/** Hard cap on a room's length, in ticks. After this, remaining fighters are ranked by HP. */
export const MAX_ROOM_TICKS = TICK_RATE * 60 * 8;

/**
 * Season points for a placement. Winner takes 100, and points fall off with the
 * fraction of the field a player outlasted, so a 3rd of 100 is worth more than a
 * 3rd of 4. Always >= 1 for showing up.
 */
export function placementPoints(place: number, entrants: number): number {
  if (place < 1 || entrants < 1 || place > entrants) return 0;
  if (place === 1) return 100;
  const outlasted = (entrants - place) / Math.max(1, entrants - 1); // 0..1
  return Math.max(1, Math.round(60 * outlasted * outlasted + 10 * outlasted));
}

/** Split N entrants into rooms of at most ROOM_CAP, as evenly as possible. */
export function roomSizes(entrants: number, cap: number = ROOM_CAP): number[] {
  if (entrants <= 0) return [];
  const rooms = Math.ceil(entrants / cap);
  const base = Math.floor(entrants / rooms);
  const extra = entrants % rooms;
  return Array.from({ length: rooms }, (_, i) => base + (i < extra ? 1 : 0));
}
