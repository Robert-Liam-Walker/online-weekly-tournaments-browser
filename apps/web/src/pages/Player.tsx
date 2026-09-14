import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { fmtLocal, ordinal } from "../lib/format";

interface Payload {
  user: { id: string; username: string; createdAt: string };
  results: { eventId: string; title: string; scheduledAt: string; place: number; entrants: number; kos: number; points: number }[];
  totalPoints: number;
}

export default function Player() {
  const { username } = useParams();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Payload>(`/users/${username}/results`).then(setData).catch((e) => setError((e as Error).message)); }, [username]);
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-slate-400">Loading...</p>;
  const wins = data.results.filter((r) => r.place === 1).length;
  return (
    <div>
      <p className="kicker">Player</p>
      <h1 className="mt-2 text-3xl font-bold">{data.user.username}</h1>
      <p className="text-slate-400">Joined {fmtLocal(data.user.createdAt)}</p>
      <div className="mt-6 flex gap-8">
        <Stat label="points" value={data.totalPoints} />
        <Stat label="events" value={data.results.length} />
        <Stat label="wins" value={wins} />
      </div>
      <div className="card mt-6 !p-0">
        {data.results.length === 0 && <p className="p-5 text-slate-400">No results yet.</p>}
        {data.results.map((r) => (
          <Link key={r.eventId} to={`/events/${r.eventId}`} className="flex items-center justify-between border-t border-ink-800 p-5 first:border-t-0 hover:bg-ink-800">
            <div><div className="font-semibold">{r.title}</div><div className="text-sm text-slate-400">{fmtLocal(r.scheduledAt)}</div></div>
            <div className="text-right"><div className={`font-semibold ${r.place === 1 ? "text-gold-300" : ""}`}>{ordinal(r.place)} of {r.entrants}</div><div className="text-sm text-slate-400">{r.kos} KOs, +{r.points}</div></div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div><div className="arcade text-2xl text-gold-300">{value}</div><div className="mt-1 text-xs uppercase tracking-wider text-slate-500">{label}</div></div>;
}
