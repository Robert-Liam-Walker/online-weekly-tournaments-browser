import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LeaderboardRow } from "@owt/shared";
import { api } from "../lib/api";
import { ordinal } from "../lib/format";

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  useEffect(() => { api<{ rows: LeaderboardRow[] }>("/leaderboard").then((r) => setRows(r.rows)).catch(() => setRows([])); }, []);
  return (
    <div>
      <p className="kicker">Season standings</p>
      <h1 className="mt-2 text-3xl font-bold">Leaderboard</h1>
      <p className="text-slate-400">Points from every weekly. A win is 100; everything else scales with how much of the field you outlasted.</p>
      <div className="card mt-6 !p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
            <tr><th className="px-5 py-3">#</th><th className="py-3">Player</th><th className="py-3">Points</th><th className="py-3">Events</th><th className="py-3">Wins</th><th className="px-5 py-3 text-right">Best</th></tr>
          </thead>
          <tbody>
            {rows === null && <tr><td className="px-5 py-4 text-slate-400" colSpan={6}>Loading...</td></tr>}
            {rows?.length === 0 && <tr><td className="px-5 py-4 text-slate-400" colSpan={6}>No results yet. The first weekly fills this in.</td></tr>}
            {rows?.map((r, i) => (
              <tr key={r.userId} className="border-t border-ink-800">
                <td className={`arcade px-5 py-3 text-xs ${i < 3 ? "text-gold-300" : "text-slate-500"}`}>{i + 1}</td>
                <td className="py-3 font-semibold"><Link to={`/players/${r.username}`} className="hover:text-gold-300">{r.username}</Link></td>
                <td className="py-3">{r.points}</td>
                <td className="py-3 text-slate-400">{r.events}</td>
                <td className="py-3 text-slate-400">{r.wins}</td>
                <td className="px-5 py-3 text-right text-slate-400">{r.bestPlace ? ordinal(r.bestPlace) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
