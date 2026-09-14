// StubEngine: a deterministic, fixed-step placeholder for one 1v1 stock game
// with the *shape* of a Melee match: a stage with a main platform and drop-through
// platforms, blast zones, percent-based knockback, stocks, respawn invincibility,
// an 8-minute clock and the standard time-out tie-breaker. It exists so the
// platform (bracket -> set -> game -> result) runs end to end before the
// decomp-derived wasm engine lands. It is not Melee; see packages/engine/README.md.
//
// Determinism: plain IEEE-754 doubles with a fixed op order and a seeded RNG,
// so server and client produce identical states for identical inputs.

import { BTN, NULL_INPUT, TICK_RATE, timeoutWinner, type Engine, type EngineEvent, type EngineInit, type PlayerInput, type PlayerState, type StageId, type WorldState } from "@owt/shared";

export const WORLD = { width: 1200, height: 700 } as const;
export const BLAST = { left: -120, right: 1320, top: -220, bottom: 820 } as const;

export interface Platform { x0: number; x1: number; y: number; solid: boolean }
export interface StageGeometry { main: Platform; platforms: Platform[]; spawn: [number, number] }

const P = (x0: number, x1: number, y: number, solid = false): Platform => ({ x0, x1, y, solid });

/** Rough silhouettes of the six legal stages, in world units (floor y grows downward). */
export const STAGES: Record<StageId, StageGeometry> = {
  fd: { main: P(150, 1050, 560, true), platforms: [], spawn: [400, 800] },
  battlefield: { main: P(220, 980, 560, true), platforms: [P(300, 500, 440), P(700, 900, 440), P(500, 700, 330)], spawn: [400, 800] },
  dreamland: { main: P(160, 1040, 560, true), platforms: [P(260, 480, 430), P(720, 940, 430), P(490, 710, 300)], spawn: [400, 800] },
  yoshis: { main: P(300, 900, 560, true), platforms: [P(340, 520, 440), P(680, 860, 440), P(520, 680, 330)], spawn: [420, 780] },
  fod: { main: P(260, 940, 560, true), platforms: [P(340, 540, 430), P(660, 860, 430)], spawn: [400, 800] },
  stadium: { main: P(160, 1040, 560, true), platforms: [P(300, 500, 440), P(700, 900, 440)], spawn: [400, 800] },
};

export const ACT = { IDLE: 0, RUN: 1, AIR: 2, ATTACK: 3, HITSTUN: 4, SHIELD: 5, RESPAWN: 6 } as const;
export const BODY = { w: 30, h: 60 } as const;

const GRAVITY = 0.85;
const FAST_FALL = 1.6;
const MAX_FALL = 18;
const RUN_SPEED = 6.5;
const AIR_SPEED = 4.5;
const JUMP_VY = -16;
const DJUMP_VY = -14;
const ATTACK_FRAMES = 20;
const ACTIVE_FROM = 5, ACTIVE_TO = 11;
const TILT_DMG = 11, SMASH_DMG = 17;
const REACH = 48;
const SHIELD_MULT = 0.2;
const RESPAWN_FRAMES = 60;
const INVINCIBLE_FRAMES = 120;

function xorshift(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
}

interface Fighter extends PlayerState { jumps: number; grounded: boolean; prevY: number; smash: boolean; ended: boolean }

export class StubEngine implements Engine {
  readonly kind = "stub" as const;
  private tick = 0;
  private timeLeft = 0;
  private stage: StageGeometry = STAGES.fd;
  private f: [Fighter, Fighter] = [this.blank(0, "fox"), this.blank(1, "marth")];
  private ended = false;
  private rng = xorshift(1);

  private blank(slot: number, character: string): Fighter {
    return { slot, character, stocks: 4, percent: 0, x: 0, y: 0, vx: 0, vy: 0, facing: slot === 0 ? 1 : -1, action: ACT.IDLE, actionFrames: 0, invincible: 0, ledgeGrabs: 0, jumps: 1, grounded: false, prevY: 0, smash: false, ended: false };
  }

  init(init: EngineInit): void {
    this.tick = 0;
    this.ended = false;
    this.timeLeft = init.timeSeconds * TICK_RATE;
    this.stage = STAGES[init.stage] ?? STAGES.fd;
    this.rng = xorshift(init.seed);
    const m = this.stage.main;
    this.f = [this.blank(0, init.characters[0]), this.blank(1, init.characters[1])];
    for (const [i, p] of this.f.entries()) {
      p.stocks = init.stocks;
      p.x = i === 0 ? m.x0 + (m.x1 - m.x0) * 0.3 - BODY.w / 2 : m.x0 + (m.x1 - m.x0) * 0.7 - BODY.w / 2;
      p.y = m.y - BODY.h;
      p.prevY = p.y;
      p.grounded = true;
    }
  }

  state(): WorldState {
    return { tick: this.tick, timeLeft: this.timeLeft, players: this.f.map((p) => this.pub(p)) };
  }

  private pub(p: Fighter): PlayerState {
    const { slot, character, stocks, percent, x, y, vx, vy, facing, action, actionFrames, invincible, ledgeGrabs } = p;
    return { slot, character, stocks, percent, x, y, vx, vy, facing, action, actionFrames, invincible, ledgeGrabs };
  }

  step(inputs: [PlayerInput, PlayerInput]): EngineEvent[] {
    const events: EngineEvent[] = [];
    if (this.ended) return events;
    this.tick++;
    this.timeLeft = Math.max(0, this.timeLeft - 1);

    for (let i = 0; i < 2; i++) this.movePlayer(this.f[i]!, inputs[i] ?? NULL_INPUT);
    for (let i = 0; i < 2; i++) this.resolveHits(this.f[i]!, this.f[1 - i]!, events);
    for (let i = 0; i < 2; i++) this.checkBlast(this.f[i]!, events);

    const alive = this.f.filter((p) => p.stocks > 0);
    if (alive.length < 2) {
      this.ended = true;
      events.push({ type: "end", tick: this.tick, winner: alive.length === 1 ? (alive[0]!.slot as 0 | 1) : null, reason: "stocks" });
      return events;
    }
    if (this.timeLeft === 0) {
      const w = timeoutWinner(this.f.map((p) => ({ stocks: p.stocks, percent: p.percent })));
      this.ended = true;
      const reason = w === null ? "timeout_replay" : this.f[0]!.stocks !== this.f[1]!.stocks ? "timeout_stocks" : "timeout_percent";
      events.push({ type: "end", tick: this.tick, winner: w, reason });
    }
    return events;
  }

  private movePlayer(p: Fighter, inp: PlayerInput): void {
    if (p.stocks <= 0) return;
    if (p.invincible > 0) p.invincible--;
    if (p.actionFrames > 0) p.actionFrames--;

    if (p.action === ACT.RESPAWN) {
      // Hover on the respawn point until the timer runs out or the player acts.
      const acted = inp.buttons !== 0 || Math.abs(inp.x) > 0.3 || inp.y < -0.5;
      if (p.actionFrames === 0 || acted) { p.action = ACT.AIR; p.jumps = 1; }
      else return;
    }

    const busy = (p.action === ACT.ATTACK || p.action === ACT.HITSTUN) && p.actionFrames > 0;
    const dead = Math.abs(inp.x) < 0.2 ? 0 : inp.x;
    if (!busy) {
      if (p.action === ACT.ATTACK || p.action === ACT.HITSTUN) p.action = p.grounded ? ACT.IDLE : ACT.AIR;
      const wantShield = (inp.buttons & BTN.SHIELD) !== 0 && p.grounded;
      if (wantShield) {
        p.action = ACT.SHIELD; p.vx = 0;
      } else if (inp.buttons & BTN.A) {
        if (dead !== 0) p.facing = dead > 0 ? 1 : -1;
        p.action = ACT.ATTACK; p.actionFrames = ATTACK_FRAMES;
        p.smash = Math.abs(inp.x) > 0.85 && p.grounded; // smash = full stick + A on the ground
        if (p.grounded) p.vx = 0;
      } else {
        if (p.grounded) {
          p.vx = dead * RUN_SPEED;
          if (dead !== 0) p.facing = dead > 0 ? 1 : -1;
          p.action = dead !== 0 ? ACT.RUN : ACT.IDLE;
          if (inp.buttons & BTN.JUMP) { p.vy = JUMP_VY; p.grounded = false; p.action = ACT.AIR; p.jumps = 1; p.jumpHeld = true; }
        } else {
          if (dead !== 0) { p.vx += dead * 0.6; p.vx = Math.max(-AIR_SPEED, Math.min(AIR_SPEED, p.vx)); p.facing = dead > 0 ? 1 : -1; }
          if ((inp.buttons & BTN.JUMP) && !p.jumpHeld && p.jumps > 0) { p.vy = DJUMP_VY; p.jumps--; }
          p.action = ACT.AIR;
        }
      }
    } else if (p.action === ACT.HITSTUN && !p.grounded && dead !== 0) {
      p.vx += dead * 0.15; // DI-ish drift
    }
    p.jumpHeld = (inp.buttons & BTN.JUMP) !== 0;

    // Integrate.
    const fastFall = !p.grounded && inp.y < -0.5 && p.vy > 0;
    p.vy = Math.min(MAX_FALL, p.vy + (fastFall ? FAST_FALL : GRAVITY));
    if (!p.grounded && p.action !== ACT.HITSTUN) p.vx *= 0.98;
    p.prevY = p.y;
    p.x += p.vx;
    p.y += p.vy;

    // Land on the main stage or a drop-through platform (only when falling, from above, not holding down).
    const wasAbove = (plat: Platform) => p.prevY + BODY.h <= plat.y + 0.01;
    const over = (plat: Platform) => p.x + BODY.w > plat.x0 && p.x < plat.x1;
    p.grounded = false;
    const candidates = [this.stage.main, ...this.stage.platforms];
    for (const plat of candidates) {
      if (p.vy < 0 || !over(plat)) continue;
      if (p.y + BODY.h < plat.y) continue;
      if (!plat.solid && (!wasAbove(plat) || inp.y < -0.5)) continue;
      if (plat.solid && !wasAbove(plat)) continue;
      p.y = plat.y - BODY.h; p.vy = 0; p.grounded = true; p.jumps = 1;
      if (p.action === ACT.AIR) p.action = ACT.IDLE;
      if (p.action === ACT.HITSTUN && p.actionFrames === 0) p.action = ACT.IDLE;
      break;
    }
    if (!p.grounded && (p.action === ACT.IDLE || p.action === ACT.RUN || p.action === ACT.SHIELD)) p.action = ACT.AIR;
  }

  private resolveHits(a: Fighter, v: Fighter, events: EngineEvent[]): void {
    if (a.stocks <= 0 || v.stocks <= 0 || a.action !== ACT.ATTACK) return;
    const elapsed = ATTACK_FRAMES - a.actionFrames;
    if (elapsed < ACTIVE_FROM || elapsed > ACTIVE_TO) return;
    if (v.action === ACT.HITSTUN || v.invincible > 0 || v.action === ACT.RESPAWN) return;
    const hx0 = a.facing === 1 ? a.x + BODY.w : a.x - REACH;
    const hx1 = hx0 + REACH;
    const hy0 = a.y + 8, hy1 = a.y + BODY.h - 8;
    if (v.x + BODY.w < hx0 || v.x > hx1 || v.y + BODY.h < hy0 || v.y > hy1) return;
    const shielded = v.action === ACT.SHIELD;
    const base = a.smash ? SMASH_DMG : TILT_DMG;
    const dmg = shielded ? base * SHIELD_MULT : base;
    v.percent = Math.min(999, v.percent + dmg);
    events.push({ type: "hit", tick: this.tick, attacker: a.slot, victim: v.slot, damage: dmg });
    if (shielded) return;
    // Knockback grows with percent; smashes launch harder.
    const kb = (a.smash ? 9 : 5) + (v.percent / 100) * (a.smash ? 16 : 9) + this.rng() * 0.5;
    v.vx = a.facing * kb * 0.85;
    v.vy = -kb * 0.7;
    v.grounded = false;
    v.action = ACT.HITSTUN;
    v.actionFrames = Math.round(8 + kb * 1.6);
    a.actionFrames = Math.min(a.actionFrames, ACTIVE_FROM); // one hit per swing
  }

  private checkBlast(p: Fighter, events: EngineEvent[]): void {
    if (p.stocks <= 0) return;
    if (p.x + BODY.w < BLAST.left || p.x > BLAST.right || p.y > BLAST.bottom || p.y + BODY.h < BLAST.top) {
      p.stocks--;
      events.push({ type: "ko", tick: this.tick, victim: p.slot, stocksLeft: p.stocks });
      if (p.stocks > 0) {
        const [sx, sy] = this.stage.spawn;
        p.x = sx + (p.slot === 0 ? -60 : 60) - BODY.w / 2; p.y = sy - 500 + 80; // above the stage
        p.vx = 0; p.vy = 0; p.percent = 0;
        p.action = ACT.RESPAWN; p.actionFrames = RESPAWN_FRAMES; p.invincible = INVINCIBLE_FRAMES + RESPAWN_FRAMES;
        p.grounded = false; p.jumps = 1;
      }
    }
  }

  serialize(): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ t: this.tick, tl: this.timeLeft, e: this.ended, f: this.f, st: this.stage }));
  }

  deserialize(data: Uint8Array): void {
    const o = JSON.parse(new TextDecoder().decode(data));
    this.tick = o.t; this.timeLeft = o.tl; this.ended = o.e; this.f = o.f; this.stage = o.st;
  }
}

declare module "@owt/shared" {
  // The stub tracks one extra transient flag per fighter.
  interface PlayerState { jumpHeld?: boolean }
}
