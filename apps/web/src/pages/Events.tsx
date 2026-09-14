import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { WeeklyEventDto } from "@owt/shared";
import { api } from "../lib/api";
import { fmtLocal } from "../lib/format";

export default function Events() {
  const [events, setEvents] = useState<WeeklyEventDto[] | null>(null);
  useEffect(() => { api<{ events: WeeklyEventDto[] }>("/events?limit=30").then((r) => setEvents(r.events)).catch(() => setEvents([])); }, []);
  return (
    <div>
      <p className="kicker">Every Friday</p>
      <h1 className="mt-2 text-3xl font-bold">Events</h1>
      <div className="card mt-6 divide-y divide-ink-700 !p-0">
        {events === null && <p className="p-5 text-slate-400">Loading...</p>}
        {events?.length === 0 && <p className="p-5 text-slate-400">Nothing yet.</p>}
        {events?.map((e) => (
          <Link key={e.id} to={e.status === "COMPLETE" || e.status === "LIVE" ? `/events/${e.id}` : "/arena"} className="flex items-center justify-between gap-4 p-5 hover:bg-ink-800">
            <div><div className="font-semibold">{e.title}</div><div className="text-sm text-slate-400">{fmtLocal(e.scheduledAt)}</div></div>
            <div className="text-right">
              <div className={`text-xs font-semibold uppercase tracking-wider ${e.status === "LIVE" ? "text-hp-500" : e.status === "COMPLETE" ? "text-slate-500" : "text-gold-300"}`}>{e.status}</div>
              <div className="text-sm text-slate-400">{e.status === "COMPLETE" || e.status === "LIVE" ? `${e.entrants ?? 0} entrants` : `${e.registered} registered`}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
