// End-to-end check / load test: N bots sign up, register for the current event,
// enter the arena and play their sets (strike, pick, ready, fight) until the
// bracket is done. Run against a local or deployed API:
//   node scripts/bots.mjs --api http://localhost:3001 --n 15
// then force-start the event (admin "Start now") or wait for the schedule.
import { io } from "socket.io-client";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const API = (args.api ?? "http://localhost:3001").replace(/\/+$/, "");
const N = Number(args.n ?? 7);
const PREFIX = args.prefix ?? `bot${Date.now().toString(36).slice(-4)}`;
const BTN_A = 1, BTN_JUMP = 4, BTN_SHIELD = 8;
const CHARS = ["fox", "falco", "marth", "sheik", "puff", "peach", "falcon", "ics", "samus", "yoshi", "luigi", "doc", "ganon", "pikachu", "link"];

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
  bots.push({ username, userId: r.user.id, token: r.token, view: null, world: null, char: CHARS[i % CHARS.length], busy: false, done: false });
}
console.log(`${N} bots registered`);

let finished = 0;
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function act(bot, action) {
  if (bot.busy) return;
  bot.busy = true;
  bot.socket.emit("match:action", { action }, (r) => { bot.busy = false; if (r?.error) console.log(bot.username, "action rejected:", r.error, action.type); });
}

function decide(bot) {
  const v = bot.view;
  if (!v || !v.set || v.slot < 0 || v.phase !== "setup") return;
  if (!v.waitingOn.includes(v.slot)) return;
  const s = v.set;
  const struckSet = new Set(s.struck);
  const neutrals = ["battlefield", "dreamland", "fd", "fod", "yoshis"].filter((x) => !struckSet.has(x));
  const legal = ["battlefield", "dreamland", "fd", "fod", "yoshis", "stadium"];
  const loser = s.games.length ? 1 - s.games[s.games.length - 1].winner : null;
  const wonOn = s.games.filter((g) => g.winner === v.slot).map((g) => g.stage);
  switch (s.phase) {
    case "striking": { const n = [1, 2, 1][s.strikeStep]; act(bot, { type: "strike", stages: neutrals.slice(0, n) }); break; }
    case "blind_pick": act(bot, { type: "blind_pick", char: bot.char }); break;
    case "ban": act(bot, { type: "ban", stages: [pick(legal)] }); break;
    case "counterpick": { const opts = legal.filter((x) => !s.banned.includes(x) && !wonOn.includes(x)); act(bot, { type: "pick_stage", stage: pick(opts) }); void loser; break; }
    case "winner_char": case "loser_char": act(bot, { type: "pick_char", char: Math.random() < 0.2 ? pick(CHARS) : bot.char }); break;
    case "ready": act(bot, { type: "ready" }); break;
  }
}

for (const bot of bots) {
  const s = io(`${API}/match`, { transports: ["websocket"], auth: { token: bot.token } });
  bot.socket = s;
  s.on("connect", () => s.emit("match:join", { eventId }, (v) => { if (v.error) console.error(bot.username, v.error); else { bot.view = v; decide(bot); } }));
  s.on("match:view", (v) => {
    const prev = bot.view;
    bot.view = v;
    if (v.matchKey && (!prev || prev.matchKey !== v.matchKey)) console.log(`${bot.username}: ${v.roundLabel} vs ${v.players[1 - v.slot].username} (${v.format})`);
    if ((v.phase === "complete" || v.phase === "forfeited") && prev?.phase !== "complete" && prev?.phase !== "forfeited" && v.set) {
      console.log(`${bot.username}: set ${v.set.winner === v.slot ? "WON" : "lost"} ${v.set.score[0]}-${v.set.score[1]} in ${v.roundLabel}${v.phase === "forfeited" ? " (forfeit)" : ""}`);
    }
    if (v.phase === "complete" && !v.matchKey && !bot.done) { bot.done = true; finished++; console.log(`${bot.username}: eliminated / done (${finished}/${N})`); }
    decide(bot);
  });
  s.on("match:snapshot", (pw) => { bot.world = pw; });
  s.on("connect_error", (e) => console.error(bot.username, "connect_error", e.message));
}

// 60 Hz input while live: chase the opponent along x, smash in reach, jump back when near an edge, shield sometimes.
setInterval(() => {
  for (const bot of bots) {
    const v = bot.view;
    if (!v || v.slot < 0 || v.phase !== "live" || !bot.world) continue;
    const me = bot.world.p[v.slot], op = bot.world.p[1 - v.slot];
    if (!me || !op) continue;
    const dx = op[3] - me[3], dy = op[4] - me[4];
    let input;
    if (me[3] < 200 || me[3] > 970) input = { x: me[3] < 200 ? 1 : -1, y: 0, buttons: Math.random() < 0.3 ? BTN_JUMP : 0 };   // recover toward the stage
    else if (dy > 40 && Math.abs(dx) < 120) input = { x: Math.sign(dx) * 0.4, y: -1, buttons: 0 };                            // opponent below: drop through
    else if (dy < -40 && Math.abs(dx) < 120) input = { x: Math.sign(dx) * 0.4, y: 0, buttons: Math.random() < 0.25 ? BTN_JUMP : 0 }; // above: jump up
    else if (Math.abs(dx) < 60) input = { x: Math.sign(dx), y: 0, buttons: Math.random() < 0.85 ? BTN_A : BTN_SHIELD };
    else input = { x: Math.sign(dx) * 0.7, y: 0, buttons: Math.random() < 0.03 ? BTN_JUMP : 0 };
    bot.socket.emit("match:input", { input });
  }
}, 1000 / 60);

setInterval(async () => {
  try {
    const e = await api(`/events/${eventId}`);
    if (e.event.status === "COMPLETE" || e.event.status === "CANCELLED") {
      const r = await api(`/events/${eventId}/results`);
      console.log("event", e.event.status, "placements:", r.placements.map((p) => `${p.place}. ${p.username} (${p.setsWon}-${p.setsLost}, +${p.points})`).join(" | "));
      process.exit(0);
    }
  } catch (err) { console.error(err.message); }
}, 5000);

console.log("bots are in the arena; start the event to begin");
