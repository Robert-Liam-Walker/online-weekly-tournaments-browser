// Compact wire form for world snapshots. 100 fighters at 20 Hz to 100 clients
// adds up, so a snapshot is an array of number arrays with rounded coordinates
// rather than an array of objects with keys.
import type { PlayerState, WorldState } from "./engine-types.js";

const r1 = (n: number) => Math.round(n * 10) / 10;

export type PackedPlayer = [alive: 0 | 1, hp: number, x: number, y: number, vx: number, vy: number, facing: 1 | -1, action: number, actionFrames: number, kos: number];
export interface PackedWorld { t: number; a: number; p: PackedPlayer[] }

export function packWorld(w: WorldState): PackedWorld {
  return {
    t: w.tick,
    a: w.alive,
    p: w.players.map((p) => [p.alive ? 1 : 0, r1(p.hp), r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.facing, p.action, p.actionFrames, p.kos]),
  };
}

export function unpackWorld(pw: PackedWorld): WorldState {
  const players: PlayerState[] = pw.p.map((q, slot) => ({
    slot, alive: q[0] === 1, hp: q[1], x: q[2], y: q[3], vx: q[4], vy: q[5], facing: q[6], action: q[7], actionFrames: q[8], kos: q[9],
  }));
  return { tick: pw.t, alive: pw.a, players };
}
