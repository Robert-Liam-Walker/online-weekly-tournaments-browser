// The arena: registration and the wait before start, then the player's
// current set (striking, picks, the game, the score) until they are out or
// they win. One page so nobody has to navigate at the wrong moment.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CHARACTERS, LEGAL_STAGES, NEUTRAL_STAGES, STRIKE_ORDER, WINS_NEEDED, characterById, counterpickOptions, remainingNeutrals, stageById, turnOf, winnerBanCount,
  type MatchView, type SetAction, type SetState, type StageId,
} from "@owt/shared";
import Countdown from "../components/Countdown";
import { useNextEvent } from "../hooks/useNextEvent";
import { MatchClient, type ClientState } from "../game/MatchClient";
import { Renderer } from "../game/Renderer";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtEastern, fmtLocal } from "../lib/format";

export default function Arena() {
  const { event, error, refresh, setEvent } = useNextEvent();
  const user = useAuth((s) => s.user);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function register(on: boolean) {
    if (!event) return;
    setBusy(true); setActionError(null);
    try { const r = await api<{ event: typeof event }>(`/events/${event.id}/register`, { method: on ? "POST" : "DELETE" }); setEvent(r.event); }
    catch (e) { setActionError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (event === undefined) return <Shell><p className="text-slate-400">Loading the arena...</p></Shell>;
  if (error) return <Shell><p className="text-danger">{error}</p></Shell>;
  if (!event) return <Shell><p className="text-slate-400">No event is scheduled yet. Check back soon.</p></Shell>;
  const open = event.status === "LOBBY" || event.status === "LIVE";

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="card flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="kicker">{labelFor(event.status)}</p>
              <h1 className="mt-1 text-2xl font-bold">{event.title}</h1>
              <p className="text-sm text-slate-400">{fmtEastern(event.scheduledAt)} ({fmtLocal(event.scheduledAt)} your time)</p>
            </div>
            <div className="flex gap-6 text-right">
              <Stat label="registered" value={event.registered} />
              {event.status === "LIVE" ? <Stat label="in bracket" value={event.entrants ?? 0} /> : <Stat label="in arena" value={event.checkedIn} />}
            </div>
          </div>

          {!event.isRegistered ? (
            <div className="card">
              <h2 className="font-semibold">You are not in this week yet</h2>
              <p className="mt-1 text-sm text-slate-400">Registration is free and you can withdraw any time before the bracket is drawn.</p>
              {actionError && <p className="mt-2 text-sm text-danger">{actionError}</p>}
              <button className="btn-gold mt-4" disabled={busy || (event.status !== "SCHEDULED" && event.status !== "LOBBY")} onClick={() => register(true)}>Register for {event.title}</button>
            </div>
          ) : open && user ? (
            <MatchPanel eventId={event.id} onDone={refresh} />
          ) : (
            <div className="card">
              <h2 className="font-semibold">You are registered</h2>
              <p className="mt-1 text-sm text-slate-400">The arena opens 15 minutes before the start. Be on this page when the clock hits zero: the bracket is drawn from whoever is here.</p>
              <Countdown to={event.scheduledAt} className="mt-5" />
              {actionError && <p className="mt-2 text-sm text-danger">{actionError}</p>}
              <button className="btn-ghost mt-5" disabled={busy} onClick={() => register(false)}>Withdraw</button>
            </div>
          )}
        </div>
        <aside className="space-y-4">
          <Controls />
          <div className="card text-sm text-slate-400">
            <p className="kicker">Format</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Double elimination. Bo3, Bo5 from winners and losers finals.</li>
              <li>4 stock, 8 minutes, items off. Standard stage list.</li>
              <li>Results auto-report. <Link to={`/events/${event.id}`} className="text-gold-300">Live bracket</Link>.</li>
            </ul>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) { return <div className="mx-auto w-full max-w-6xl px-4 py-8">{children}</div>; }
function Stat({ label, value }: { label: string; value: number }) {
  return <div><div className="arcade text-xl text-gold-300">{value}</div><div className="text-xs uppercase tracking-wider text-slate-500">{label}</div></div>;
}
function labelFor(status: string) {
  return status === "LIVE" ? "Bracket live" : status === "LOBBY" ? "Arena open" : status === "COMPLETE" ? "Finished" : status === "CANCELLED" ? "Cancelled" : "Upcoming";
}
function Controls() {
  return (
    <div className="card text-sm">
      <p className="kicker">Controls</p>
      <table className="mt-2 w-full text-slate-300"><tbody>
        <Row k="Move" v="Arrows or WASD, left stick" /><Row k="Jump" v="Space or Z, A button" /><Row k="Attack" v="X or J, X button (hold direction for a smash)" /><Row k="Shield" v="Shift or K, L/R" /><Row k="Fast fall" v="Down in the air" />
      </tbody></table>
      <p className="mt-2 text-xs text-slate-500">Plug in a controller any time; it takes over when you touch it.</p>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) { return <tr><td className="py-1 pr-3 font-semibold text-slate-200">{k}</td><td className="py-1 text-slate-400">{v}</td></tr>; }

// ---------------------------------------------------------------------------

function MatchPanel({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const client = useMemo(() => new MatchClient(), []);
  const [state, setState] = useState<ClientState>(client.state);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { const unsub = client.subscribe(setState); client.connect(eventId); return () => { unsub(); client.disconnect(); }; }, [client, eventId]);
  useEffect(() => { if (state.view?.phase === "complete" || state.view?.phase === "forfeited") onDone(); }, [state.view?.phase, onDone]);

  const act = async (action: SetAction) => { setErr(null); try { await client.act(action); } catch (e) { setErr((e as Error).message); } };
  const v = state.view;

  if (state.error) return <div className="card"><p className="text-danger">{state.error}</p><button className="btn-ghost mt-3" onClick={() => client.connect(eventId)}>Retry</button></div>;
  if (!v) return <div className="card text-slate-400">Connecting to the arena...</div>;

  if (!v.matchKey) {
    return (
      <div className="card">
        {v.phase === "waiting" && <><h2 className="font-semibold">You are checked in</h2><p className="mt-1 text-sm text-slate-400">Stay on this page. When the clock hits zero the bracket is drawn and your first opponent appears here.</p></>}
        {v.phase === "no_match" && <><h2 className="font-semibold">Waiting for your next opponent</h2><p className="mt-1 text-sm text-slate-400">Their set is still going. Keep this page open; you will be pulled in the moment it ends.</p></>}
        {v.phase === "complete" && <><h2 className="font-semibold">Your run is over</h2><p className="mt-1 text-sm text-slate-400">Thanks for playing. Placements and points post when the bracket finishes.</p></>}
        <Link to={`/events/${eventId}`} className="btn-ghost mt-4">Watch the bracket</Link>
        <p className="mt-3 text-xs text-slate-500">{state.connected ? <span className="text-hp-500">Connected</span> : <span className="text-danger">Disconnected</span>}</p>
      </div>
    );
  }

  const me = v.slot, opp = (me === 0 ? 1 : 0) as 0 | 1;
  const set = v.set!;
  const players = v.players!;
  const myTurn = me !== -1 && v.waitingOn.includes(me);
  const inGame = v.phase === "countdown" || v.phase === "live";

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center justify-between gap-3 !py-3">
        <div>
          <p className="kicker">{v.roundLabel} · {v.format === "BO5" ? "Best of 5" : "Best of 3"}</p>
          <div className="mt-1 text-lg font-bold">
            <span className={me === 0 ? "text-gold-300" : ""}>{players[0].username}</span>
            <span className="arcade mx-3 text-sm text-slate-300">{set.score[0]} - {set.score[1]}</span>
            <span className={me === 1 ? "text-gold-300" : ""}>{players[1].username}</span>
          </div>
        </div>
        <div className="text-right text-xs text-slate-400">
          <div>Game {set.gameNumber}{set.tiebreakPending ? " (last-stock replay)" : ""}, first to {WINS_NEEDED[set.format]}</div>
          <div>{players[opp]?.connected ? <span className="text-hp-500">Opponent connected</span> : <span className="text-danger">Opponent disconnected</span>}{v.noShowDeadline && !players[opp]?.connected && <> · forfeits in <Deadline at={v.noShowDeadline} now={() => client.serverNow()} /></>}</div>
        </div>
      </div>

      {v.phase === "waiting" && <div className="card text-slate-300">Waiting for <b>{players[opp]?.username}</b> to enter the arena. {v.noShowDeadline && <>They forfeit in <Deadline at={v.noShowDeadline} now={() => client.serverNow()} />.</>}</div>}

      {v.phase === "setup" && <SetupStep set={set} me={me} myTurn={myTurn} players={players} act={act} waitingOn={v.waitingOn} />}

      {inGame && <GameCanvas client={client} view={v} />}

      {(v.phase === "complete" || v.phase === "forfeited") && (
        <div className="card text-center">
          <p className="kicker">{set.winner === me ? "You won the set" : "Set lost"}</p>
          <p className="arcade mt-3 text-2xl text-gold-300">{set.score[0]} - {set.score[1]}</p>
          {v.phase === "forfeited" && <p className="mt-2 text-sm text-slate-400">Decided by forfeit.</p>}
          <p className="mt-2 text-sm text-slate-400">{set.winner === me ? "Your next opponent appears here as soon as their set ends." : "Losers bracket if you have a life left; otherwise, thanks for playing."}</p>
          <Link to={`/events/${eventId}`} className="btn-ghost mt-4">Bracket</Link>
        </div>
      )}

      {err && <p className="text-sm text-danger">{err}</p>}
      <p className="text-xs text-slate-500">
        {state.connected ? <span className="text-hp-500">Connected</span> : <span className="text-danger">Disconnected</span>} · Engine: <b className="text-slate-300">{v.engine === "wasm" ? "Melee (wasm)" : "placeholder"}</b>
        {v.engine === "stub" && <> · the placeholder engine runs the full set procedure while the decomp-derived Melee engine is being built; fighters are boxes.</>}
      </p>
    </div>
  );
}

function Deadline({ at, now }: { at: number; now: () => number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.ceil((at - now()) / 1000));
  return <b className="text-slate-200">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</b>;
}

// ---- set-up steps ---------------------------------------------------------

function SetupStep({ set, me, myTurn, players, act, waitingOn }: { set: SetState; me: 0 | 1 | -1; myTurn: boolean; players: NonNullable<MatchView["players"]>; act: (a: SetAction) => Promise<void>; waitingOn: (0 | 1)[] }) {
  const [picked, setPicked] = useState<StageId[]>([]);
  useEffect(() => setPicked([]), [set.phase, set.strikeStep, set.gameNumber]);
  const who = waitingOn.map((i) => players[i].username).join(" and ");

  const stageGrid = (options: StageId[], need: number, onConfirm: (s: StageId[]) => void, label: string) => (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LEGAL_STAGES.map((st) => {
          const available = options.includes(st.id), struck = set.struck.includes(st.id), sel = picked.includes(st.id);
          return (
            <button key={st.id} disabled={!myTurn || !available} onClick={() => setPicked((p) => (sel ? p.filter((x) => x !== st.id) : need === 1 ? [st.id] : [...p, st.id].slice(-need)))}
              className={`rounded-md border px-3 py-3 text-left text-sm transition ${sel ? "border-gold-400 bg-gold-400/10 text-gold-300" : available ? "border-ink-600 hover:border-gold-400" : "border-ink-800 text-slate-600 line-through"} ${struck ? "opacity-40" : ""}`}>
              <div className="font-semibold">{st.name}</div>
              <div className="text-xs text-slate-500">{NEUTRAL_STAGES.some((n) => n.id === st.id) ? "Neutral" : "Counterpick"}</div>
            </button>
          );
        })}
      </div>
      {myTurn && <button className="btn-gold mt-3" disabled={picked.length !== need} onClick={() => onConfirm(picked)}>{label}</button>}
    </div>
  );

  const charGrid = (onPick: (c: string) => void, current: string | null) => (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-7">
      {CHARACTERS.map((c) => (
        <button key={c.id} disabled={!myTurn} onClick={() => onPick(c.id)} className={`rounded-md border px-2 py-2 text-xs transition ${current === c.id ? "border-gold-400 text-gold-300" : "border-ink-600 hover:border-gold-400"}`}>{c.name}</button>
      ))}
    </div>
  );

  const header = (title: string, hint: string) => (
    <div className="mb-3">
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-slate-400">{myTurn ? hint : `Waiting for ${who || "your opponent"}.`}</p>
    </div>
  );

  switch (set.phase) {
    case "striking": {
      const step = STRIKE_ORDER[set.strikeStep]!;
      return <div className="card">{header(`Game 1: stage striking (${set.strikeStep + 1} of ${STRIKE_ORDER.length})`, `Strike ${step[1]} stage${step[1] > 1 ? "s" : ""}. The last neutral standing is game 1.`)}{stageGrid(remainingNeutrals(set), step[1], (s) => void act({ type: "strike", stages: s }), `Strike ${step[1]}`)}</div>;
    }
    case "blind_pick":
      return <div className="card">{header(`Game 1 on ${stageById(set.stage!)?.name}: double-blind character pick`, "Both pick at the same time; nobody sees the other pick first.")}{me !== -1 && set.blindSubmitted[me] ? <p className="text-sm text-hp-500">Locked in: {characterById(set.chars[me]!)?.name}. Waiting for {players[me === 0 ? 1 : 0].username}.</p> : charGrid((c) => void act({ type: "blind_pick", char: c }), null)}</div>;
    case "ban":
      return <div className="card">{header(`Game ${set.gameNumber}: winner bans ${winnerBanCount(set.format)}`, "Ban one stage from your opponent's counterpick.")}{stageGrid(LEGAL_STAGES.map((s) => s.id), winnerBanCount(set.format), (s) => void act({ type: "ban", stages: s }), "Ban")}</div>;
    case "counterpick":
      return <div className="card">{header(`Game ${set.gameNumber}: loser picks the stage`, "Pick any legal stage you have not already won on this set (and not the banned one).")}{stageGrid(counterpickOptions(set), 1, (s) => void act({ type: "pick_stage", stage: s[0]! }), "Play here")}</div>;
    case "winner_char":
    case "loser_char": {
      const t = turnOf(set);
      return <div className="card">{header(`Game ${set.gameNumber} on ${stageById(set.stage!)?.name}: ${set.phase === "winner_char" ? "winner" : "loser"} picks character`, "Keep your character or switch.")}{charGrid((c) => void act({ type: "pick_char", char: c }), t !== null ? set.chars[t] : null)}</div>;
    }
    case "ready":
      return (
        <div className="card">
          {header(`Game ${set.gameNumber}${set.tiebreakPending ? " (last-stock replay, 2 minutes)" : ""}: ${stageById(set.stage!)?.name}`, "Ready up. The game starts five seconds after both players are ready.")}
          <p className="text-sm text-slate-300">{players[0].username} ({characterById(set.chars[0]!)?.name}) vs {players[1].username} ({characterById(set.chars[1]!)?.name})</p>
          {me !== -1 && (set.ready[me] ? <p className="mt-3 text-sm text-hp-500">You are ready. Waiting for {players[me === 0 ? 1 : 0].username}.</p> : <button className="btn-gold mt-3" onClick={() => void act({ type: "ready" })}>Ready</button>)}
        </div>
      );
    default:
      return null;
  }
}

// ---- the game --------------------------------------------------------------

function GameCanvas({ client, view }: { client: MatchClient; view: MatchView }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Renderer(canvas, { mySlot: view.slot, names: [view.players![0].username, view.players![1].username], stage: view.set!.stage ?? "fd" });
    client.onEvents = (e) => renderer.onEvents(e);
    let raf = 0;
    const loop = () => {
      const v = client.state.view;
      renderer.setOptions({ mySlot: v?.slot ?? -1, names: v?.players ? [v.players[0].username, v.players[1].username] : ["", ""], stage: v?.set?.stage ?? "fd" });
      let overlay: string | null = null;
      if (v?.phase === "countdown" && v.startAt) { const left = Math.ceil((v.startAt - client.serverNow()) / 1000); overlay = left > 0 ? String(left) : "GO"; }
      const alpha = Math.min(1, (performance.now() - client.worldAt) / 50);
      renderer.draw(client.world, client.prevWorld, alpha, overlay);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); client.onEvents = null; };
  }, [client, view.slot]);
  return <div className="relative aspect-[12/7] w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-900"><canvas ref={canvasRef} className="h-full w-full" /></div>;
}
