export default function About() {
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <p className="kicker">About</p>
        <h1 className="mt-2 text-3xl font-bold">How this is built</h1>
        <p className="mt-2 text-slate-400">
          Online Weekly Tournament Series began as a Slippi-based weekly with an in-game bracket. This is its browser edition: the same weekly slot,
          the same double-elimination format, with the game itself running in the page.
        </p>
      </div>

      <Block title="Platform">
        <p>A TypeScript monorepo. <code>apps/web</code> is a Vite + React site. <code>apps/api</code> is a Fastify server with Prisma on Postgres for accounts, weekly events, registrations, every set result and final placements, plus a socket.io match server that runs the live sets. <code>packages/shared</code> holds the ruleset as data, the set state machine (striking, blind picks, bans, counterpicks, DSR, ready-up), the double-elimination bracket engine, the wire protocol and the engine interface; <code>packages/engine</code> holds the two engine implementations.</p>
      </Block>

      <Block title="The bracket and the sets">
        <p>At start time the bracket is drawn from registered players who are in the arena, seeded by season points. Every playable set gets a match room on the server: it walks both players through the ruleset step by step, launches each game as an authoritative 60 Hz simulation, decides the game (stocks, or the time-out tie-breaker), and reports the set into the bracket the moment it ends. The next sets open automatically. No-shows and abandoned sets forfeit on a clock. Every result is persisted, so a server restart rebuilds the bracket and restarts only the unfinished sets.</p>
      </Block>

      <Block title="The engine">
        <p>The engine sits behind a small interface (init a game with a stage, two characters, stocks and a clock; step; state; snapshot). Two implementations exist. The <b>placeholder</b> is a deterministic box-fighter with percent, knockback, stocks and blast zones that lets the entire platform run end to end. The <b>Melee engine</b> is the game's own fighter, physics and collision code from the matching decompilation, compiled to WebAssembly.</p>
        <p className="mt-2">The decomp is C for a big-endian PowerPC whose data files are read in place as structs, so it cannot simply be recompiled for a little-endian target. The engine build reuses the PC port's approach: clang's PowerPC front-end emits LLVM IR, an IR pass rewrites every memory access to keep game memory byte-identical to a GameCube while values stay native in registers, and the module is retargeted, in our case to wasm32. The GameCube SDK is then provided by native shims: disc reads from the player's own disc image via the File API, the memory card in IndexedDB, pads from the Gamepad API, rendering through Aurora, a GC/Wii SDK reimplementation that already targets WebGPU.</p>
      </Block>

      <Block title="Legal posture">
        <p>No Nintendo assets are in the repository or on the server. The decompilation is source code, not game data. Players supply their own legally dumped disc image; it is read in the browser and never uploaded. Not affiliated with Nintendo.</p>
      </Block>

      <Block title="Code">
        <p>The platform is public on GitHub as <code>online-weekly-tournaments-browser</code>. The engine build script, the ABI shim and the port notes live in <code>packages/engine/build</code> and <code>docs/ENGINE.md</code>.</p>
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card text-slate-300"><h2 className="font-semibold text-gold-300">{title}</h2><div className="mt-2 space-y-2 text-sm leading-relaxed">{children}</div></section>;
}
