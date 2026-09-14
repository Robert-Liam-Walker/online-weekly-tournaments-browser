import { Link } from "react-router-dom";
import { nextWeeklyStart } from "@owt/shared";
import Countdown from "../components/Countdown";
import { useNextEvent } from "../hooks/useNextEvent";
import { useAuth } from "../lib/auth";
import { fmtEastern, fmtLocal } from "../lib/format";

export default function Landing() {
  const { event } = useNextEvent();
  const user = useAuth((s) => s.user);
  const start = event ? new Date(event.scheduledAt) : nextWeeklyStart();
  const live = event?.status === "LIVE";

  return (
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-xl border border-ink-700 bg-gradient-to-br from-ink-900 via-ink-950 to-ink-900 p-8 sm:p-12">
        <div className="scanlines absolute inset-0" />
        <div className="relative">
          <p className="kicker">Free weekly Melee tournament</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-extrabold leading-tight sm:text-6xl">
            Double elimination.<br />
            <span className="text-gold-400">In your browser.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-300">
            Super Smash Bros. Melee under the standard ruleset: 4 stock, 8 minutes, stage striking, counterpicks, DSR. No install, no launcher.
            Sign up, show up Friday at 8 PM Eastern, play your bracket.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to={user ? "/arena" : "/signup"} className="btn-gold !px-6 !py-3 !text-base">{live ? "Bracket is live" : user ? "Enter the arena" : "Sign up free"}</Link>
            <Link to="/rules" className="btn-ghost !px-6 !py-3 !text-base">Read the rules</Link>
          </div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
        <div className="card">
          <p className="kicker">{live ? "Live now" : "Next event"}</p>
          <h2 className="mt-2 text-2xl font-bold">{event?.title ?? "Weekly"}</h2>
          <p className="mt-1 text-slate-400">{fmtEastern(start)}</p>
          <p className="text-sm text-slate-500">{fmtLocal(start)} your time</p>
          {!live && <Countdown to={start} className="mt-6" />}
          <div className="mt-6 flex gap-6 text-sm">
            <Stat label="registered" value={event?.registered ?? 0} />
            <Stat label="in the arena" value={event?.checkedIn ?? 0} />
          </div>
        </div>
        <div className="card space-y-4">
          <p className="kicker">Three steps</p>
          <Step n={1} title="Sign up" body="One account, free forever. Register for this week with one click." />
          <Step n={2} title="Show up" body="The arena opens 15 minutes before start. Be in it when the clock hits zero and the bracket draws around you." />
          <Step n={3} title="Play your sets" body="Strike stages, pick blind, counterpick, play. Results report themselves and the next set finds you." />
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        <Feature title="Standard rules, enforced" body="Striking order, bans, DSR, the time-out tie-breaker and no-show forfeits are code, not a judgement call." />
        <Feature title="Runs in the browser" body="The game engine is compiled from the Melee decompilation to WebAssembly and rendered with WebGPU. Nothing to download." />
        <Feature title="Your disc, your data" body="No game files are hosted here. The site reads what it needs from your own disc image, on your machine, and never uploads it." />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div><div className="arcade text-xl text-gold-300">{value}</div><div className="mt-1 text-xs uppercase tracking-wider text-slate-500">{label}</div></div>;
}
function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return <div className="flex gap-4"><div className="arcade grid h-9 w-9 shrink-0 place-items-center rounded border border-gold-400 text-xs text-gold-400">{n}</div><div><div className="font-semibold">{title}</div><div className="text-sm text-slate-400">{body}</div></div></div>;
}
function Feature({ title, body }: { title: string; body: string }) {
  return <div className="card"><h3 className="font-semibold text-gold-300">{title}</h3><p className="mt-2 text-sm text-slate-400">{body}</p></div>;
}
