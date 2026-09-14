// Compact wire form for world snapshots (arrays, rounded coordinates).
import type { PlayerState, WorldState } from "./engine-types.js";

const r1 = (n: number) => Math.round(n * 10) / 10;

export type PackedPlayer = [character: string, stocks: number, percent: number, x: number, y: number, vx: number, vy: number, facing: 1 | -1, action: number, actionFrames: number, invincible: number, ledgeGrabs: number];
export interface PackedWorld { t: number; tl: number; p: PackedPlayer[] }

export function packWorld(w: WorldState): PackedWorld {
  return {
    t: w.tick,
    tl: w.timeLeft,
    p: w.players.map((p) => [p.character, p.stocks, r1(p.percent), r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.facing, p.action, p.actionFrames, p.invincible, p.ledgeGrabs]),
  };
}

export function unpackWorld(pw: PackedWorld): WorldState {
  const players: PlayerState[] = pw.p.map((q, slot) => ({
    slot, character: q[0], stocks: q[1], percent: q[2], x: q[3], y: q[4], vx: q[5], vy: q[6], facing: q[7], action: q[8], actionFrames: q[9], invincible: q[10], ledgeGrabs: q[11],
  }));
  return { tick: pw.t, timeLeft: pw.tl, players };
}
