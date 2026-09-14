// Event page: the live or final bracket, and placements once complete.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { characterById, stageById, type BracketDto, type BracketMatchDto, type PlacementDto } from "@owt/shared";
import { api, SOCKET_URL } from "../lib/api";
import { fmtLocal, ordinal } from "../lib/format";

interface ResultsPayload { event: { id: string; title: string; scheduledAt: string; status: string; entrants: number }; placements: PlacementDto[] }

export default function Results() {
  const { id } = useParams();
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [bracket, setBracket] = useState<BracketDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, b] = await Promise.all([api<ResultsPayload>(`/events/${id}/results`), api<{ bracket: BracketDto | null }>(`/events/${id}/bracket`)]);
      setData(r); setBracket(b.bracket);
    } catch (e) { setError((e as Error).message); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const s = io(`${SOCKET_URL ?? ""}/lobby`, { transports: ["websocket"] });
    s.on("lobby:bracket", (u: { eventId: string }) => { if (u.eventId === id) void load(); });
    s.on("lobby:event", (u: { eventId: string }) => { if (u.eventId === id) void load(); });
    return () => { s.disconnect(); };
  }, [id, load]);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-slate-400">Loading...</p>;

  return (
    <div className="space-y-8">
      <div>
        <p className="kicker">{data.event.status === "COMPLETE" ? "Final" : data.event.status === "LIVE" ? "Live bracket" : data.event.status}</p>
        <h1 className="mt-2 text-3xl font-bold">{data.event.title}</h1>
        <p className="text-slate-400">{fmtLocal(data.event.scheduledAt)}{bracket ? `, ${bracket.players.length} entrants` : ""}</p>
      </div>

      {data.placements.length > 0 && (
        <div className="card !p-0">
          <div className="border-b border-ink-700 px-5 py-3 font-semibold">Placements</div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-2">Place</th><th className="py-2">Player</th><th className="py-2">Sets</th><th className="px-5 py-2 text-right">Points</th></tr></thead>
            <tbody>{data.placements.map((p) => (
              <tr key={p.userId} className="border-t border-ink-800">
                <td className={`px-5 py-2 font-semibold ${p.place === 1 ? "text-gold-300" : ""}`}>{ordinal(p.place)}</td>
                <td className="py-2"><Link to={`/players/${p.username}`} className="hover:text-gold-300">{p.username}</Link></td>
                <td className="py-2 text-slate-400">{p.setsWon}-{p.setsLost}</td>
                <td className="px-5 py-2 text-right">{p.points}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {bracket ? <Bracket b={bracket} /> : <p className="card text-slate-400">The bracket is drawn when the event starts.</p>}
    </div>
  );
}

function Bracket({ b }: { b: BracketDto }) {
  const name = (id: string | null | undefined) => (id === undefined ? "TBD" : id === null ? "bye" : b.players.find((p) => p.userId === id)?.username ?? "?");
  const seed = (id: string | null | undefined) => (id ? b.players.find((p) => p.userId === id)?.seed : undefined);
  const rounds = (side: "W" | "L") => {
    const map = new Map<number, BracketMatchDto[]>();
    for (const m of b.matches) if (m.side === side) map.set(m.round, [...(map.get(m.round) ?? []), m]);
    return [...map.entries()].sort((a, c) => a[0] - c[0]);
  };
  const finals = b.matches.filter((m) => m.side === "GF" || (m.side === "GFR" && !m.cancelled));

  const Match = ({ m }: { m: BracketMatchDto }) => {
    const row = (pid: string | null | undefined, score: number, slot: 0 | 1) => {
      const winner = m.done && m.winnerId === pid && pid;
      return (
        <div className={`flex items-center justify-between gap-2 px-2 py-1 text-xs ${winner ? "font-semibold text-gold-300" : pid === undefined || pid === null ? "text-slate-600" : "text-slate-200"}`}>
          <span className="truncate">{seed(pid) ? <span className="mr-1 text-slate-500">{seed(pid)}</span> : null}{name(pid)}</span>
          <span className="arcade text-[10px]">{m.done || m.live ? score : ""}{m.forfeit && m.done && m.winnerId !== pid && pid ? " FF" : ""}</span>
        </div>
      );
    };
    const games = m.games.map((g) => `${stageById(g.stage)?.name ?? g.stage}: ${characterById(g.chars[0])?.name ?? g.chars[0]} vs ${characterById(g.chars[1])?.name ?? g.chars[1]}, ${g.winner === 0 ? name(m.p1) : name(m.p2)}${g.tiebreak ? " (replay)" : ""}`).join("\n");
    return (
      <div title={games || undefined} className={`w-44 rounded border ${m.live ? "border-hp-500" : m.done ? "border-ink-600" : "border-ink-700"} bg-ink-900`}>
        <div className="flex justify-between border-b border-ink-800 px-2 py-0.5 text-[10px] text-slate-500"><span>{m.key}</span><span>{m.format === "BO5" ? "Bo5" : "Bo3"}{m.live ? " · live" : ""}</span></div>
        {row(m.p1, m.score[0], 0)}
        {row(m.p2, m.score[1], 1)}
      </div>
    );
  };

  const Side = ({ title, rs }: { title: string; rs: [number, BracketMatchDto[]][] }) => (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-300">{title}</h3>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {rs.map(([r, ms]) => (
          <div key={r} className="flex flex-col justify-around gap-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Round {r}</div>
            {ms.sort((a, c) => a.matchNumber - c.matchNumber).map((m) => <Match key={m.key} m={m} />)}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="card space-y-6">
      {b.champion && <p className="kicker">Champion: <span className="text-gold-300">{name(b.champion)}</span></p>}
      <Side title="Winners" rs={rounds("W")} />
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-300">Grand Finals</h3>
        <div className="flex gap-4">{finals.map((m) => <Match key={m.key} m={m} />)}</div>
      </div>
      <Side title="Losers" rs={rounds("L")} />
    </div>
  );
}
