import { ROOM_CAP, STAMINA_HP, placementPoints } from "@owt/shared";

export default function Rules() {
  const sample = [1, 2, 3, 5, 10, 25, 50, 100].map((p) => [p, placementPoints(p, 100)] as const);
  return (
    <div className="prose-invert max-w-3xl space-y-8">
      <div>
        <p className="kicker">How it works</p>
        <h1 className="mt-2 text-3xl font-bold">Rules</h1>
      </div>
      <Section title="Schedule">
        One event every Friday at 8:00 PM Eastern. The arena opens 15 minutes before. You must be registered <em>and</em> in the arena when the clock hits zero; the boxes are drawn from whoever is present.
      </Section>
      <Section title="The box">
        Up to {ROOM_CAP} fighters per box. If more than {ROOM_CAP} show up, the field is split into equal boxes and every box plays at once. Placement and points come from your own box.
      </Section>
      <Section title="Stamina">
        Everyone starts at {STAMINA_HP} HP. Damage subtracts HP; knockback grows as HP falls. At 0 HP you are eliminated and your placement is locked in. The last fighter standing wins. A box that somehow runs past eight minutes ends with the survivors ranked by remaining HP.
      </Section>
      <Section title="Points">
        <p>A win is worth 100. Everything else scales with how much of the field you outlasted, so surviving to 10th in a box of 100 beats 3rd in a box of 4. In a box of 100:</p>
        <table className="mt-3 text-sm">
          <tbody>{sample.map(([p, pts]) => <tr key={p}><td className="pr-6 text-slate-400">{p}{p === 1 ? "st" : p === 2 ? "nd" : p === 3 ? "rd" : "th"}</td><td>{pts} pts</td></tr>)}</tbody>
        </table>
      </Section>
      <Section title="Fair play">
        One account per person. Disconnecting mid-box leaves your fighter idle in the box; reconnect and you take control again. Anything that manipulates the game client or the connection is a ban.
      </Section>
      <Section title="Your disc">
        The site does not host any game data. When the Melee engine is enabled the browser asks for your own NTSC 1.02 disc image once, reads only the files it needs, and keeps them in your browser storage. Nothing is uploaded.
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card"><h2 className="font-semibold text-gold-300">{title}</h2><div className="mt-2 text-slate-300">{children}</div></section>;
}
