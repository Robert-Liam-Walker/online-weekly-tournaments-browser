import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PlacementDto } from "@owt/shared";
import { api } from "../lib/api";
import { fmtLocal, ordinal } from "../lib/format";

interface Payload { event: { id: string; title: string; scheduledAt: string; status: string }; placements: PlacementDto[] }

export default function Results() {
  const { id } = useParams();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Payload>(`/events/${id}/results`).then(setData).catch((e) => setError((e as Error).message)); }, [id]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-slate-400">Loading...</p>;
  const rooms = new Map<number, PlacementDto[]>();
  for (const p of data.placements) rooms.set(p.roomIndex, [...(rooms.get(p.roomIndex) ?? []), p]);

  return (
    <div>
      <p className="kicker">{data.event.status === "COMPLETE" ? "Final results" : data.event.status}</p>
      <h1 className="mt-2 text-3xl font-bold">{data.event.title}</h1>
      <p className="text-slate-400">{fmtLocal(data.event.scheduledAt)}</p>
      {data.placements.length === 0 && <p className="card mt-6 text-slate-400">No placements recorded for this event.</p>}
      {[...rooms.entries()].sort((a, b) => a[0] - b[0]).map(([idx, rows]) => (
        <div key={idx} className="card mt-6 !p-0">
          <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
            <h2 className="font-semibold">Box {idx + 1}</h2>
            <span className="text-sm text-slate-400">{rows.length} fighters</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
              <tr><th className="px-5 py-2">Place</th><th className="py-2">Player</th><th className="py-2">KOs</th><th className="px-5 py-2 text-right">Points</th></tr>
            </thead>
            <tbody>
              {rows.sort((a, b) => a.place - b.place).map((p) => (
                <tr key={p.userId} className="border-t border-ink-800">
                  <td className={`px-5 py-2 font-semibold ${p.place === 1 ? "text-gold-300" : ""}`}>{ordinal(p.place)}</td>
                  <td className="py-2"><Link to={`/players/${p.username}`} className="hover:text-gold-300">{p.username}</Link></td>
                  <td className="py-2 text-slate-400">{p.kos}</td>
                  <td className="px-5 py-2 text-right">{p.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
