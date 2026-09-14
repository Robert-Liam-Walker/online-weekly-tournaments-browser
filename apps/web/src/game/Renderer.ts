// Canvas 2D renderer for the stub engine's world: the box, 100 fighters, HP
// bars, hit flashes, and a KO ticker. The wasm engine renders itself (Aurora on
// WebGPU) into the same canvas element, so this file is only for the stub.
import type { EngineEvent, WorldState } from "@owt/shared";
import { ARENA, STUB_ACTIONS, STUB_BODY } from "@owt/engine";

const PALETTE = ["#f5b32b", "#3ddc84", "#5aa9ff", "#ff6b6b", "#c77dff", "#ff9f43", "#48dbfb", "#ff9ff3", "#feca57", "#1dd1a1"];

export interface RenderOptions {
  mySlot: number;
  names: string[];
  staminaHp: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private flashes = new Map<number, number>(); // slot -> frames left
  private ticker: { text: string; until: number }[] = [];

  constructor(private canvas: HTMLCanvasElement, private opts: RenderOptions) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
  }

  setOptions(o: Partial<RenderOptions>) { Object.assign(this.opts, o); }

  onEvents(events: EngineEvent[]) {
    const now = performance.now();
    for (const e of events) {
      if (e.type === "hit") this.flashes.set(e.victim, 6);
      else if (e.type === "elim") this.ticker.unshift({ text: `${this.name(e.by)} KO'd ${this.name(e.slot)} (${e.place}${suffix(e.place)})`, until: now + 6000 });
      else if (e.type === "end") this.ticker.unshift({ text: e.winner === null ? "Nobody survived" : `${this.name(e.winner)} wins!`, until: now + 60000 });
    }
    this.ticker = this.ticker.slice(0, 6);
  }

  private name(slot: number | null) { return slot === null ? "The box" : (this.opts.names[slot] ?? `P${slot + 1}`); }

  draw(world: WorldState | null, prev: WorldState | null, alpha: number, overlay: string | null) {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) { canvas.width = cw * dpr; canvas.height = ch * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // Fit the arena.
    const scale = Math.min(cw / ARENA.width, ch / ARENA.height);
    const ox = (cw - ARENA.width * scale) / 2, oy = (ch - ARENA.height * scale) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // Box.
    ctx.fillStyle = "#0b0f17";
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);
    ctx.strokeStyle = "#273047"; ctx.lineWidth = 2;
    for (let x = 0; x <= ARENA.width; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA.height); ctx.stroke(); }
    for (let y = 0; y <= ARENA.height; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA.width, y); ctx.stroke(); }
    ctx.fillStyle = "#1b2334"; ctx.fillRect(0, ARENA.floorY, ARENA.width, ARENA.height - ARENA.floorY);
    ctx.strokeStyle = "#f5b32b"; ctx.lineWidth = 4; ctx.strokeRect(2, 2, ARENA.width - 4, ARENA.height - 4);

    if (world) {
      const w = STUB_BODY.w, h = STUB_BODY.h;
      for (const p of world.players) {
        if (!p.alive) continue;
        const q = prev?.players[p.slot];
        const x = q && q.alive ? q.x + (p.x - q.x) * alpha : p.x;
        const y = q && q.alive ? q.y + (p.y - q.y) * alpha : p.y;
        const mine = p.slot === this.opts.mySlot;
        const color = PALETTE[p.slot % PALETTE.length]!;
        const flash = (this.flashes.get(p.slot) ?? 0) > 0;

        // Shield bubble.
        if (p.action === STUB_ACTIONS.SHIELD) { ctx.fillStyle = "rgba(90,169,255,.35)"; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, h * 0.7, 0, Math.PI * 2); ctx.fill(); }
        // Body.
        ctx.fillStyle = flash ? "#ffffff" : color;
        ctx.fillRect(x, y, w, h);
        if (mine) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.strokeRect(x - 3, y - 3, w + 6, h + 6); }
        // Eyes show facing.
        ctx.fillStyle = "#06080d";
        ctx.fillRect(x + (p.facing === 1 ? w - 10 : 4), y + 10, 6, 6);
        // Attack swipe.
        if (p.action === STUB_ACTIONS.ATTACK && p.actionFrames > 8 && p.actionFrames < 14) {
          ctx.fillStyle = "rgba(255,255,255,.55)";
          const ax = p.facing === 1 ? x + w : x - 46;
          ctx.fillRect(ax, y + 10, 46, h - 20);
        }
        // HP bar.
        const frac = Math.max(0, p.hp / this.opts.staminaHp);
        ctx.fillStyle = "#06080d"; ctx.fillRect(x - 5, y - 12, w + 10, 6);
        ctx.fillStyle = frac > 0.5 ? "#3ddc84" : frac > 0.25 ? "#f5b32b" : "#ff5c5c";
        ctx.fillRect(x - 5, y - 12, (w + 10) * frac, 6);
        // Name for me and nearby.
        if (mine) { ctx.fillStyle = "#fff"; ctx.font = "bold 14px Inter, sans-serif"; ctx.textAlign = "center"; ctx.fillText("YOU", x + w / 2, y - 18); }
      }
      for (const [slot, n] of this.flashes) { if (n <= 1) this.flashes.delete(slot); else this.flashes.set(slot, n - 1); }
    }
    ctx.restore();

    // HUD.
    ctx.font = "bold 18px Inter, sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = "#e2e8f0";
    if (world) {
      ctx.fillText(`${world.alive} alive`, 16, 28);
      const me = world.players[this.opts.mySlot];
      if (me) { ctx.textAlign = "right"; ctx.fillText(`HP ${Math.max(0, Math.round(me.hp))}   KOs ${me.kos}`, cw - 16, 28); }
    }
    const now = performance.now();
    this.ticker = this.ticker.filter((t) => t.until > now);
    ctx.textAlign = "left"; ctx.font = "13px Inter, sans-serif";
    this.ticker.forEach((t, i) => { ctx.fillStyle = i === 0 ? "#ffd98a" : "#94a3b8"; ctx.fillText(t.text, 16, 52 + i * 18); });

    if (overlay) {
      ctx.fillStyle = "rgba(6,8,13,.65)"; ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = "#f5b32b"; ctx.textAlign = "center"; ctx.font = "bold 40px Inter, sans-serif";
      ctx.fillText(overlay, cw / 2, ch / 2);
    }
  }
}

function suffix(n: number) { const v = n % 100; return ["th", "st", "nd", "rd"][(v - 20) % 10] ?? ["th", "st", "nd", "rd"][v] ?? "th"; }
