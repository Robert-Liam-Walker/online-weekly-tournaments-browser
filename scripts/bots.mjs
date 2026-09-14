// Load test / end-to-end check: N bots sign up, register for the current event,
// enter the arena and fight. Run against a local or deployed API:
//   node scripts/bots.mjs --api http://localhost:3001 --n 100
// Then start the event (admin "Start now", or wait for the schedule). Each bot
// logs its final placement; the script exits when every bot has a result.
import { io } from "socket.io-client";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const API = (args.api ?? "http://localhost:3001").replace(/\/+$/, "");
const N = Number(args.n ?? 20);
const PREFIX = args.prefix ?? `bot${Date.now().toString(36).slice(-4)}`;
const BTN_A = 1, BTN_JUMP = 4, BTN_SHIELD = 8;

async function api(path, init = {}, token) {
  const headers = { ...(init.json ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`${API}/api${path}`, { ...init, headers, body: init.json ? JSON.stringify(init.json) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: ${data?.error ?? res.status}`);
  return data;
}

const next = await api("/events/next");
if (!next.event) { console.error("no event scheduled"); process.exit(1); }
const eventId = next.event.id;
console.log(`event ${next.event.title} (${next.event.status}) id=${eventId}`);

const bots = [];
for (let i = 0; i < N; i++) {
  const username = `${PREFIX}_${i}`;
  const r = await api("/auth/register", { method: "POST", json: { username, email: `${username}@bots.local`, password: "botbotbot1" } });
  await api(`/events/${eventId}/register`, { method: "POST" }, r.token);
  bots.push({ username, token: r.token, slot: -1, world: null, result: null });
}
console.log(`${N} bots registered`);

let done = 0;
for (const bot of bots) {
  const s = io(`${API}/room`, { transports: ["websocket"], auth: { token: bot.token } });
  bot.socket = s;
  s.on("connect", () => s.emit("room:join", { eventId }, (w) => { if (w.error) console.error(bot.username, w.error); else bot.slot = w.slot; }));
  s.on("room:assigned", (a) => { bot.slot = a.slot; });
  s.on("room:snapshot", (pw) => { bot.world = pw; });
  s.on("room:phase", (p) => { bot.phase = p.phase; if (p.phase === "voided") { console.log(bot.username, "voided"); finish(bot); } });
  s.on("room:result", (r) => { bot.result = r; console.log(`${bot.username}: ${r.place}/${r.entrants} (${r.kos} KOs, +${r.points})`); finish(bot); });
  s.on("connect_error", (e) => console.error(bot.username, "connect_error", e.message));
}

function finish(bot) {
  if (bot.done) return;
  bot.done = true;
  done++;
  if (done >= N) { console.log("all bots finished"); setTimeout(() => process.exit(0), 500); }
}

// 60 Hz input: hunt the nearest living opponent using the last snapshot.
setInterval(() => {
  for (const bot of bots) {
    if (bot.slot < 0 || bot.phase !== "live" || !bot.world) continue;
    const p = bot.world.p;
    const me = p[bot.slot];
    if (!me || !me[0]) continue;
    let best = null;
    for (let i = 0; i < p.length; i++) {
      if (i === bot.slot || !p[i][0]) continue;
      const dx = p[i][2] - me[2], d = Math.abs(dx) + Math.abs(p[i][3] - me[3]) * 0.5;
      if (!best || d < best.d) best = { dx, d };
    }
    const input = !best ? { x: 0, y: 0, buttons: 0 }
      : { x: Math.sign(best.dx), y: 0, buttons: (Math.abs(best.dx) < 60 ? BTN_A : 0) | (Math.random() < 0.02 ? BTN_JUMP : 0) | (Math.random() < 0.01 ? BTN_SHIELD : 0) };
    bot.socket.emit("room:input", { input });
  }
}, 1000 / 60);

console.log("bots are in the arena; start the event to begin");
