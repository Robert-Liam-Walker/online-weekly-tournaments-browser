import { COUNTERPICK_STAGES, DISCONNECT_FORFEIT_MINUTES, SETUP_ACTION_MINUTES, LGL_ALWAYS, LGL_TIMEOUT, NEUTRAL_STAGES, NO_SHOW_FORFEIT_MINUTES, STOCKS, TIEBREAK_REPLAY_MINUTES, TIME_MINUTES, placementPoints } from "@owt/shared";

export default function Rules() {
  const sample = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25].map((p) => [p, placementPoints(p, 32)] as const);
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="kicker">Standard singles ruleset</p>
        <h1 className="mt-2 text-3xl font-bold">Rules</h1>
        <p className="mt-2 text-slate-400">The recommended competitive Melee ruleset, enforced by the platform rather than by a TO with a clipboard. Wording follows the community standard.</p>
      </div>

      <Section title="Schedule and format">
        <ul className="list-disc space-y-1 pl-5">
          <li>One event every Friday at 8:00 PM Eastern. The arena opens 15 minutes before; the bracket is drawn from registered players who are in the arena at the start.</li>
          <li>Double elimination, seeded by season points. Sets are best 2 out of 3, and 3 out of 5 for winners finals, losers finals and grand finals.</li>
          <li>Results report themselves. Your next set opens in the arena the moment it is ready.</li>
        </ul>
      </Section>

      <Section title="Game settings">
        <ul className="list-disc space-y-1 pl-5">
          <li>{STOCKS} stocks, {TIME_MINUTES} minutes.</li>
          <li>Items are turned off. Pause is turned off.</li>
        </ul>
      </Section>

      <Section title="Stages">
        <p><b>Neutral:</b> {NEUTRAL_STAGES.map((s) => s.name).join(", ")}.</p>
        <p className="mt-1"><b>Counterpick:</b> {COUNTERPICK_STAGES.map((s) => s.name).join(", ")}.</p>
        <p className="mt-1">All other stages are banned.</p>
      </Section>

      <Section title="Game 1">
        <ul className="list-disc space-y-1 pl-5">
          <li>Stage striking from the neutral list: the first striker (decided by coin flip) removes one stage, the second removes two, the first removes one more. The remaining stage is played.</li>
          <li>Characters are chosen double-blind, at the same time, so neither player knows the other's character beforehand.</li>
        </ul>
      </Section>

      <Section title="Games 2 and on">
        <ul className="list-disc space-y-1 pl-5">
          <li>The winner of the previous game may ban one stage from the opponent's selection, except in best-of-5 sets.</li>
          <li>The loser of the previous game chooses the next stage from the full legal list, then the winner chooses their character, then the loser chooses theirs.</li>
          <li>The loser cannot choose any stage they have already won on in the current set (Dave's Stupid Rule).</li>
        </ul>
      </Section>

      <Section title="Time-outs and ties">
        <ul className="list-disc space-y-1 pl-5">
          <li>If time runs out, the player with more stocks wins. With equal stocks, the player with less damage wins.</li>
          <li>With equal stocks and equal damage, or if both players lose their last stock on the same frame, the last stock is replayed on the same stage with a {TIEBREAK_REPLAY_MINUTES}-minute timer. Sudden Death is not played.</li>
        </ul>
      </Section>

      <Section title="Ledge grabs and stalling">
        <ul className="list-disc space-y-1 pl-5">
          <li>Ledge grab limit: a player who exceeds {LGL_TIMEOUT} ledge grabs in a game that times out forfeits that game; exceeding {LGL_ALWAYS} forfeits the game regardless. (Counted by the Melee engine; not enforced while the placeholder engine is in use.)</li>
          <li>Stalling is banned: repeated rising Pound, repeated Peach Bomber on a wall, the Luigi ladder and similar. Using those moves to recover is fine.</li>
          <li>Wobbling is not permitted in this series.</li>
        </ul>
      </Section>

      <Section title="Showing up">
        <ul className="list-disc space-y-1 pl-5">
          <li>A player who is not in the arena {NO_SHOW_FORFEIT_MINUTES} minutes after their set is ready forfeits it.</li>
          <li>A player who disconnects mid-set and does not return within {DISCONNECT_FORFEIT_MINUTES} minutes forfeits the set. Reconnecting puts you straight back in.</li>
          <li>Sitting on a strike, a pick or the ready button for {SETUP_ACTION_MINUTES} minutes forfeits the set.</li>
          <li>One account per person. Anything that manipulates the game client or the connection is a ban.</li>
        </ul>
      </Section>

      <Section title="Season points">
        <p>100 for a win; everything else scales with how much of the field you outlasted, so a deep run in a big bracket beats a shallow one in a small bracket. Ties (5th, 7th, 9th...) share the tier. In a 32-player bracket:</p>
        <table className="mt-3 text-sm"><tbody>{sample.map(([p, pts]) => <tr key={p}><td className="pr-6 text-slate-400">{p === 1 ? "1st" : p === 2 ? "2nd" : p === 3 ? "3rd" : `${p}th`}</td><td>{pts} pts</td></tr>)}</tbody></table>
      </Section>

      <Section title="Your disc">
        <p>The site hosts no game data. When the Melee engine is enabled the browser asks for your own NTSC 1.02 disc image once, reads only the files it needs, and keeps them in your browser storage. Nothing is uploaded.</p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card"><h2 className="font-semibold text-gold-300">{title}</h2><div className="mt-2 text-sm leading-relaxed text-slate-300">{children}</div></section>;
}
