// Canvas 2D renderer for the stub engine: stage silhouette, blast-zone hint,
// two fighters, percent + stocks HUD, clock, KO ticker. The wasm engine renders
// itself (Aurora on WebGPU) into the same canvas, so this is stub-only.
import { characterById, stageById, type EngineEvent, type WorldState } from "@owt/shared";
import { ACT, BODY, STAGES, WORLD } from "@owt/engine";

const COLORS = ["#f5b32b", "#5aa9ff"];

export interface RenderOptions {
  mySlot: number;
  names: [string, string];
  stage: string;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private flashes = new Map<number, number>();
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
      else if (e.type === "ko") this.ticker.unshift({ text: `${this.opts.names[e.victim] ?? "?"} lost a stock (${e.stocksLeft} left)`, until: now + 5000 });
      else if (e.type === "end") this.ticker.unshift({ text: e.winner === null ? "Time! Dead even: last stock replays" : `${this.opts.names[e.winner] ?? "?"} wins the game${e.reason.startsWith("timeout") ? " on time" : ""}`, until: now + 8000 });
    }
    this.ticker = this.ticker.slice(0, 4);
  }

  draw(world: WorldState | null, prev: WorldState | null, alpha: number, overlay: string | null) {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) { canvas.width = cw * dpr; canvas.height = ch * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const scale = Math.min(cw / WORLD.width, ch / WORLD.height);
    const ox = (cw - WORLD.width * scale) / 2, oy = (ch - WORLD.height * scale) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // Sky + stage.
    const grad = ctx.createLinearGradient(0, 0, 0, WORLD.height);
    grad.addColorStop(0, "#0b1220"); grad.addColorStop(1, "#141c2e");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    const geo = STAGES[(this.opts.stage as keyof typeof STAGES) ?? "fd"] ?? STAGES.fd;
    ctx.fillStyle = "#2a3550"; ctx.fillRect(geo.main.x0, geo.main.y, geo.main.x1 - geo.main.x0, WORLD.height - geo.main.y);
    ctx.fillStyle = "#f5b32b"; ctx.fillRect(geo.main.x0, geo.main.y, geo.main.x1 - geo.main.x0, 4);
    for (const p of geo.platforms) { ctx.fillStyle = "#3b4a6b"; ctx.fillRect(p.x0, p.y, p.x1 - p.x0, 8); }
    // Blast-zone hint at the world edge.
    ctx.strokeStyle = "rgba(255,92,92,.25)"; ctx.setLineDash([12, 10]); ctx.lineWidth = 2; ctx.strokeRect(2, 2, WORLD.width - 4, WORLD.height - 4); ctx.setLineDash([]);

    if (world) {
      for (const p of world.players) {
        if (p.stocks <= 0) continue;
        const q = prev?.players[p.slot];
        const x = q ? q.x + (p.x - q.x) * alpha : p.x;
        const y = q ? q.y + (p.y - q.y) * alpha : p.y;
        const color = COLORS[p.slot] ?? "#fff";
        const flash = (this.flashes.get(p.slot) ?? 0) > 0;
        if (p.action === ACT.SHIELD) { ctx.fillStyle = "rgba(90,169,255,.35)"; ctx.beginPath(); ctx.arc(x + BODY.w / 2, y + BODY.h / 2, BODY.h * 0.7, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = p.invincible > 0 && Math.floor(world.tick / 4) % 2 === 0 ? 0.45 : 1;
        ctx.fillStyle = flash ? "#ffffff" : color;
        ctx.fillRect(x, y, BODY.w, BODY.h);
        ctx.globalAlpha = 1;
        if (p.slot === this.opts.mySlot) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.strokeRect(x - 3, y - 3, BODY.w + 6, BODY.h + 6); }
        ctx.fillStyle = "#06080d"; ctx.fillRect(x + (p.facing === 1 ? BODY.w - 10 : 4), y + 10, 6, 6);
        if (p.action === ACT.ATTACK && p.actionFrames > 8 && p.actionFrames < 16) { ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillRect(p.facing === 1 ? x + BODY.w : x - 48, y + 8, 48, BODY.h - 16); }
        ctx.fillStyle = "#e2e8f0"; ctx.font = "bold 12px Inter, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(this.opts.names[p.slot] ?? "", x + BODY.w / 2, y - 8);
      }
      for (const [slot, n] of this.flashes) { if (n <= 1) this.flashes.delete(slot); else this.flashes.set(slot, n - 1); }
    }
    ctx.restore();

    // HUD: percent + stocks per player, clock in the middle.
    if (world) {
      const hud = (slot: number, alignRight: boolean) => {
        const p = world.players[slot]; if (!p) return;
        const x = alignRight ? cw - 24 : 24;
        ctx.textAlign = alignRight ? "right" : "left";
        ctx.fillStyle = COLORS[slot] ?? "#fff"; ctx.font = "bold 14px Inter, sans-serif";
        ctx.fillText(`${this.opts.names[slot] ?? ""}  ${characterById(p.character)?.name ?? p.character}`, x, ch - 44);
        ctx.fillStyle = "#fff"; ctx.font = "bold 30px Inter, sans-serif";
        ctx.fillText(`${Math.round(p.percent)}%`, x, ch - 14);
        ctx.font = "16px Inter, sans-serif"; ctx.fillStyle = "#ffd98a";
        const stocks = "●".repeat(Math.max(0, p.stocks));
        ctx.fillText(stocks, alignRight ? x - 90 : x + 90, ch - 14);
      };
      hud(0, false); hud(1, true);
      const secs = Math.ceil(world.timeLeft / 60);
      ctx.textAlign = "center"; ctx.fillStyle = secs <= 30 ? "#ff5c5c" : "#e2e8f0"; ctx.font = "bold 22px Inter, sans-serif";
      ctx.fillText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, cw / 2, 30);
      ctx.font = "12px Inter, sans-serif"; ctx.fillStyle = "#94a3b8";
      ctx.fillText(stageById(this.opts.stage)?.name ?? "", cw / 2, 48);
    }
    const now = performance.now();
    this.ticker = this.ticker.filter((t) => t.until > now);
    ctx.textAlign = "left"; ctx.font = "13px Inter, sans-serif";
    this.ticker.forEach((t, i) => { ctx.fillStyle = i === 0 ? "#ffd98a" : "#94a3b8"; ctx.fillText(t.text, 16, 28 + i * 18); });

    if (overlay) {
      ctx.fillStyle = "rgba(6,8,13,.65)"; ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = "#f5b32b"; ctx.textAlign = "center"; ctx.font = "bold 40px Inter, sans-serif";
      ctx.fillText(overlay, cw / 2, ch / 2);
    }
  }
}
