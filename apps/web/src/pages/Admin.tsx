import { useEffect, useState } from "react";
import type { WeeklyEventDto } from "@owt/shared";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtLocal } from "../lib/format";

export default function Admin() {
  const user = useAuth((s) => s.user);
  const [events, setEvents] = useState<WeeklyEventDto[]>([]);
  const [when, setWhen] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api<{ events: WeeklyEventDto[] }>("/events?limit=20").then((r) => setEvents(r.events)).catch((e) => setMsg((e as Error).message));
  useEffect(() => { void load(); }, []);

  if (user?.role !== "ADMIN") return <p className="text-slate-400">Admins only.</p>;

  async function act(path: string, json?: unknown) {
    setMsg(null);
    try { await api(path, { method: "POST", json }); await load(); setMsg("Done."); }
    catch (e) { setMsg((e as Error).message); }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div><p className="kicker">Admin</p><h1 className="mt-2 text-3xl font-bold">Events</h1></div>
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label className="label" htmlFor="when">Schedule an extra event (local time; blank = next Friday 8 PM ET)</label>
          <input id="when" type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <button className="btn-gold" onClick={() => act("/events", when ? { scheduledAt: new Date(when).toISOString() } : {})}>Create</button>
      </div>
      {msg && <p className="text-sm text-gold-300">{msg}</p>}
      <div className="card !p-0">
        {events.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 p-4 first:border-t-0">
            <div>
              <div className="font-semibold">{e.title} <span className="ml-2 text-xs uppercase tracking-wider text-slate-500">{e.status}</span></div>
              <div className="text-sm text-slate-400">{fmtLocal(e.scheduledAt)}, {e.registered} registered, {e.checkedIn} present</div>
            </div>
            <div className="flex gap-2">
              {(e.status === "SCHEDULED" || e.status === "LOBBY") && <button className="btn-gold !py-1" onClick={() => act(`/events/${e.id}/start`)}>Start now</button>}
              {e.status !== "COMPLETE" && e.status !== "CANCELLED" && <button className="btn-ghost !py-1" onClick={() => act(`/events/${e.id}/cancel`)}>Cancel</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
