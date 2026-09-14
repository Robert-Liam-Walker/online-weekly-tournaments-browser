// The arena: registration + waiting room before start, the game during, and the
// result after. One page so a player never has to navigate at the wrong moment.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { STAMINA_HP } from "@owt/shared";
import Countdown from "../components/Countdown";
import { useNextEvent } from "../hooks/useNextEvent";
import { GameClient, type ClientState } from "../game/GameClient";
import { Renderer } from "../game/Renderer";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtEastern, fmtLocal, ordinal } from "../lib/format";

export default function Arena() {
  const { event, error, refresh, setEvent } = useNextEvent();
  const user = useAuth((s) => s.user);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function register(on: boolean) {
    if (!event) return;
    setBusy(true); setActionError(null);
    try {
      const r = await api<{ event: typeof event }>(`/events/${event.id}/register`, { method: on ? "POST" : "DELETE" });
      setEvent(r.event);
    } catch (e) { setActionError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (event === undefined) return <Shell><p className="text-slate-400">Loading the arena...</p></Shell>;
  if (error) return <Shell><p className="text-danger">{error}</p></Shell>;
  if (!event) return <Shell><p className="text-slate-400">No event is scheduled yet. Check back soon.</p></Shell>;

  const open = event.status === "LOBBY" || event.status === "LIVE";

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="card flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="kicker">{labelFor(event.status)}</p>
              <h1 className="mt-1 text-2xl font-bold">{event.title}</h1>
              <p className="text-sm text-slate-400">{fmtEastern(event.scheduledAt)} ({fmtLocal(event.scheduledAt)} your time)</p>
            </div>
            <div className="text-right">
              <div className="arcade text-xl text-gold-300">{event.registered}</div>
              <div className="text-xs uppercase tracking-wider text-slate-500">registered</div>
            </div>
          </div>

          {!event.isRegistered ? (
            <div className="card">
              <h2 className="font-semibold">You are not in this week yet</h2>
              <p className="mt-1 text-sm text-slate-400">Registration is free and you can withdraw any time before the start.</p>
              {actionError && <p className="mt-2 text-sm text-danger">{actionError}</p>}
              <button className="btn-gold mt-4" disabled={busy || (event.status !== "SCHEDULED" && event.status !== "LOBBY")} onClick={() => register(true)}>
                Register for {event.title}
              </button>
            </div>
          ) : open && user ? (
            <Game eventId={event.id} username={user.username} onDone={refresh} />
          ) : (
            <div className="card">
              <h2 className="font-semibold">You are registered</h2>
              <p className="mt-1 text-sm text-slate-400">The arena opens 15 minutes before the start. Keep this page open then; when the countdown hits zero you are in the box.</p>
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
              <li>Up to 100 per box; bigger fields split into parallel boxes.</li>
              <li>Stamina mode, {STAMINA_HP} HP each. 0 HP is elimination.</li>
              <li>Placement is elimination order. Points go to the season <Link to="/leaderboard" className="text-gold-300">leaderboard</Link>.</li>
            </ul>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-8">{children}</div>;
}

function labelFor(status: string) {
  return status === "LIVE" ? "Live now" : status === "LOBBY" ? "Arena open" : status === "COMPLETE" ? "Finished" : status === "CANCELLED" ? "Cancelled" : "Upcoming";
}

function Controls() {
  return (
    <div className="card text-sm">
      <p className="kicker">Controls</p>
      <table className="mt-2 w-full text-slate-300">
        <tbody>
          <Row k="Move" v="Arrows or WASD, left stick" />
          <Row k="Jump" v="Space or Z, A button" />
          <Row k="Attack" v="X or J, X button" />
          <Row k="Shield" v="Shift or K, L/R" />
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">Plug in a controller any time; it takes over when you touch it.</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <tr><td className="py-1 pr-3 font-semibold text-slate-200">{k}</td><td className="py-1 text-slate-400">{v}</td></tr>;
}

// ---------------------------------------------------------------------------

function Game({ eventId, username, onDone }: { eventId: string; username: string; onDone: () => void }) {
  const client = useMemo(() => new GameClient(), []);
  const [state, setState] = useState<ClientState>(client.state);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const unsub = client.subscribe(setState);
    client.connect(eventId);
    return () => { unsub(); client.disconnect(); };
  }, [client, eventId]);

  useEffect(() => { if (state.phase === "finished" || state.phase === "voided") onDone(); }, [state.phase, onDone]);

  // Render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Renderer(canvas, { mySlot: state.slot, names: [], staminaHp: STAMINA_HP });
    client.onEvents = (e) => renderer.onEvents(e);
    let raf = 0;
    const loop = () => {
      renderer.setOptions({ mySlot: client.state.slot, names: client.state.roster.map((r) => r.username) });
      const { phase, startAt } = client.state;
      let overlay: string | null = null;
      if (phase === "countdown" && startAt) {
        const left = Math.ceil((startAt - client.serverNow()) / 1000);
        overlay = left > 0 ? String(left) : "GO";
      } else if (phase === "waiting") overlay = "Waiting for the start";
      else if (phase === "voided") overlay = "Not enough players";
      const alpha = Math.min(1, (performance.now() - client.worldAt) / 50);
      renderer.draw(client.world, client.prevWorld, alpha, overlay);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => { cancelAnimationFrame(raf); clearInterval(t); client.onEvents = null; };
  }, [client, state.slot]);

  const present = state.roster.filter((r) => r.connected).length;
  void tick;

  return (
    <div className="space-y-3">
      <div className="relative aspect-[12/7] w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-900">
        <canvas ref={canvasRef} className="h-full w-full" />
        {state.error && (
          <div className="absolute inset-0 grid place-items-center bg-ink-950/80 p-6 text-center">
            <div><p className="text-danger">{state.error}</p><button className="btn-ghost mt-3" onClick={() => client.connect(eventId)}>Retry</button></div>
          </div>
        )}
        {state.result && (
          <div className="absolute inset-0 grid place-items-center bg-ink-950/85 p-6 text-center">
            <div>
              <p className="kicker">{state.result.place === 1 ? "Winner" : "Eliminated"}</p>
              <p className="arcade mt-3 text-4xl text-gold-300">{ordinal(state.result.place)}</p>
              <p className="mt-2 text-slate-300">of {state.result.entrants} in your box, {state.result.kos} KOs, +{state.result.points} points</p>
              <Link to={`/events/${eventId}`} className="btn-gold mt-5">See the full results</Link>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-400">
        <span>{state.connected ? <span className="text-hp-500">Connected</span> : <span className="text-danger">Disconnected</span>}</span>
        <span>Phase: <b className="text-slate-200">{state.phase}</b></span>
        {state.roomIndex >= 0 && <span>Box {state.roomIndex + 1}, slot {state.slot + 1}</span>}
        {state.roster.length > 0 && <span>{present}/{state.roster.length} present</span>}
        <span>Engine: <b className="text-slate-200">{state.engine === "wasm" ? "Melee (wasm)" : "placeholder"}</b></span>
        <span className="text-slate-500">Signed in as {username}</span>
      </div>
      {state.engine === "stub" && (
        <p className="text-xs text-slate-500">
          The placeholder engine is running while the decomp-derived Melee engine is being built. Same rooms, same rules, same results; only the fighters are boxes.
        </p>
      )}
    </div>
  );
}
