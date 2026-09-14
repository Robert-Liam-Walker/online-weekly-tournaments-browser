// StubEngine: a deterministic, fixed-step placeholder simulation with the *shape*
// of the royale (box arena, stamina HP, hits, knockback, eliminations, placements).
// It exists so the platform (lobby -> room -> results -> leaderboard) is playable
// end-to-end before the decomp-derived wasm engine lands. It is not Melee and
// makes no attempt to be; see packages/engine/README.md for the real engine plan.
//
// Determinism: all math is plain IEEE-754 doubles with a fixed op order and a
// seeded xorshift RNG, so server and client produce identical states for
// identical inputs (transcendental Math.* functions are avoided on purpose).

import { BTN, NULL_INPUT, type Engine, type EngineEvent, type EngineInit, type PlayerInput, type PlayerState, type WorldState } from "@owt/shared";

export const ARENA = { width: 1200, height: 700, floorY: 620, wallPad: 20 } as const;

const ACT = { IDLE: 0, RUN: 1, JUMP: 2, ATTACK: 3, HITSTUN: 4, SHIELD: 5 } as const;

const GRAVITY = 0.9;
const RUN_SPEED = 6;
const AIR_SPEED = 4.5;
const JUMP_VY = -17;
const ATTACK_FRAMES = 18;
const ATTACK_ACTIVE_FROM = 5;
const ATTACK_ACTIVE_TO = 10;
const ATTACK_DAMAGE = 12;
const ATTACK_REACH = 46;
const BODY_W = 30;
const BODY_H = 60;
const HITSTUN_FRAMES = 22;
const SHIELD_DAMAGE_MULT = 0.25;

function xorshift(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

export class StubEngine implements Engine {
  readonly kind = "stub" as const;
  private tick = 0;
  private players: PlayerState[] = [];
  private rng = xorshift(1);
  private ended = false;
  private eliminatedCount = 0;
  private staminaHp = 150;
  private lastHitBy: (number | null)[] = [];

  init(init: EngineInit): void {
    this.tick = 0;
    this.ended = false;
    this.eliminatedCount = 0;
    this.staminaHp = init.staminaHp;
    this.rng = xorshift(init.seed);
    this.players = [];
    this.lastHitBy = [];
    // Spawn in a grid across the box, alternating facing, small seeded jitter.
    const cols = Math.max(1, Math.ceil(Math.sqrt(init.slots * 1.7)));
    const cellW = (ARENA.width - ARENA.wallPad * 2) / cols;
    for (let i = 0; i < init.slots; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = ARENA.wallPad + cellW * (col + 0.5) + (this.rng() - 0.5) * 8;
      const y = ARENA.floorY - BODY_H - row * 90;
      this.players.push({ slot: i, alive: true, hp: init.staminaHp, x, y, vx: 0, vy: 0, facing: col % 2 === 0 ? 1 : -1, action: ACT.IDLE, actionFrames: 0, kos: 0 });
      this.lastHitBy.push(null);
    }
  }

  state(): WorldState {
    return { tick: this.tick, players: this.players.map((p) => ({ ...p })), alive: this.players.filter((p) => p.alive).length };
  }

  step(inputs: PlayerInput[]): EngineEvent[] {
    const events: EngineEvent[] = [];
    if (this.ended) return events;
    this.tick++;
    const n = this.players.length;

    // 1. Intent + movement.
    for (let i = 0; i < n; i++) {
      const p = this.players[i]!;
      if (!p.alive) continue;
      const inp = inputs[i] ?? NULL_INPUT;
      const grounded = p.y + BODY_H >= ARENA.floorY - 0.001;

      if (p.actionFrames > 0) p.actionFrames--;
      const busy = (p.action === ACT.ATTACK || p.action === ACT.HITSTUN) && p.actionFrames > 0;

      if (!busy) {
        if (p.action === ACT.ATTACK || p.action === ACT.HITSTUN) p.action = ACT.IDLE;
        const shield = (inp.buttons & BTN.SHIELD) !== 0 && grounded;
        if (shield) {
          p.action = ACT.SHIELD; p.vx = 0;
        } else if (inp.buttons & BTN.A) {
          // A stick direction with the swing turns the fighter first (turn-around attack).
          if (Math.abs(inp.x) >= 0.2) p.facing = inp.x > 0 ? 1 : -1;
          p.action = ACT.ATTACK; p.actionFrames = ATTACK_FRAMES;
          if (grounded) p.vx = 0;
        } else {
          const speed = grounded ? RUN_SPEED : AIR_SPEED;
          const dead = Math.abs(inp.x) < 0.2 ? 0 : inp.x;
          p.vx = dead * speed;
          if (dead !== 0) p.facing = dead > 0 ? 1 : -1;
          if ((inp.buttons & BTN.JUMP) && grounded) { p.vy = JUMP_VY; p.action = ACT.JUMP; }
          else if (grounded) p.action = dead !== 0 ? ACT.RUN : ACT.IDLE;
          else p.action = ACT.JUMP;
        }
      }
      // Integrate.
      p.vy += GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      if (p.y + BODY_H > ARENA.floorY) { p.y = ARENA.floorY - BODY_H; p.vy = 0; if (p.action === ACT.HITSTUN && p.actionFrames === 0) p.action = ACT.IDLE; }
      if (p.x < ARENA.wallPad) { p.x = ARENA.wallPad; p.vx = 0; }
      if (p.x + BODY_W > ARENA.width - ARENA.wallPad) { p.x = ARENA.width - ARENA.wallPad - BODY_W; p.vx = 0; }
      if (p.y < 0) { p.y = 0; p.vy = 0; }
    }

    // 2. Hit detection: active attack frames sweep a box in front of the attacker.
    for (let i = 0; i < n; i++) {
      const a = this.players[i]!;
      if (!a.alive || a.action !== ACT.ATTACK) continue;
      const elapsed = ATTACK_FRAMES - a.actionFrames;
      if (elapsed < ATTACK_ACTIVE_FROM || elapsed > ATTACK_ACTIVE_TO) continue;
      const hx0 = a.facing === 1 ? a.x + BODY_W : a.x - ATTACK_REACH;
      const hx1 = hx0 + ATTACK_REACH;
      const hy0 = a.y + 10, hy1 = a.y + BODY_H - 10;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const v = this.players[j]!;
        if (!v.alive || v.action === ACT.HITSTUN) continue;
        if (v.x + BODY_W < hx0 || v.x > hx1 || v.y + BODY_H < hy0 || v.y > hy1) continue;
        const shielded = v.action === ACT.SHIELD;
        const dmg = shielded ? ATTACK_DAMAGE * SHIELD_DAMAGE_MULT : ATTACK_DAMAGE;
        v.hp = Math.max(0, v.hp - dmg);
        this.lastHitBy[j] = i;
        events.push({ type: "hit", tick: this.tick, attacker: i, victim: j, damage: dmg });
        if (!shielded) {
          const scale = 1 + (this.staminaHp - v.hp) / this.staminaHp; // weaker fighters fly further
          v.vx = a.facing * 7 * scale; v.vy = -6 * scale;
          v.action = ACT.HITSTUN; v.actionFrames = HITSTUN_FRAMES;
        }
        if (v.hp <= 0) this.eliminate(j, i, events);
      }
    }

    // 3. Win.
    const alive = this.players.filter((p) => p.alive);
    if (alive.length <= 1 && n >= 1) {
      const winner = alive[0] ?? null;
      this.ended = true;
      events.push({ type: "end", tick: this.tick, winner: winner ? winner.slot : null });
    }
    return events;
  }

  private eliminate(slot: number, by: number | null, events: EngineEvent[]) {
    const p = this.players[slot]!;
    if (!p.alive) return;
    p.alive = false;
    this.eliminatedCount++;
    const place = this.players.length - this.eliminatedCount + 1;
    if (by !== null && by !== slot) this.players[by]!.kos++;
    events.push({ type: "elim", tick: this.tick, slot, by, place });
  }

  /** Rank remaining fighters by HP when a room hits its tick cap. */
  forceEnd(): EngineEvent[] {
    const events: EngineEvent[] = [];
    if (this.ended) return events;
    const alive = this.players.filter((p) => p.alive).sort((a, b) => a.hp - b.hp || b.slot - a.slot);
    for (let i = 0; i < alive.length - 1; i++) this.eliminate(alive[i]!.slot, this.lastHitBy[alive[i]!.slot] ?? null, events);
    const winner = this.players.find((p) => p.alive) ?? null;
    this.ended = true;
    events.push({ type: "end", tick: this.tick, winner: winner ? winner.slot : null });
    return events;
  }

  serialize(): Uint8Array {
    const s = JSON.stringify({ t: this.tick, e: this.ended, c: this.eliminatedCount, h: this.staminaHp, p: this.players, l: this.lastHitBy });
    return new TextEncoder().encode(s);
  }

  deserialize(data: Uint8Array): void {
    const o = JSON.parse(new TextDecoder().decode(data));
    this.tick = o.t; this.ended = o.e; this.eliminatedCount = o.c; this.staminaHp = o.h; this.players = o.p; this.lastHitBy = o.l;
  }
}

export const STUB_ACTIONS = ACT;
export const STUB_BODY = { w: BODY_W, h: BODY_H } as const;
