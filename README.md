# Online Weekly Tournament Series, browser edition

A free weekly Super Smash Bros. Melee tournament that runs in the browser: **100
fighters in one box, stamina mode, last one standing**, every Friday at 8 PM Eastern.

This is the browser successor to the Slippi-based weekly (a double-elimination
bracket played inside a Dolphin fork). The weekly slot, the brand and the domain
carry over; the client is now a web page.

## What is here

```
apps/web/          Vite + React site: landing, sign-up, arena, results, leaderboard
apps/api/          Fastify API + socket.io room server + Prisma/Postgres + scheduler
packages/shared/   rules, weekly schedule math, wire protocol, engine interface
packages/engine/   the engine boundary: deterministic stub today, decomp-derived wasm next
scripts/           local dev database (embedded Postgres) and a 100-bot load test
docs/              ARCHITECTURE.md, ENGINE.md, DEPLOY.md
```

## Run it locally

```sh
npm install
npm run db          # embedded Postgres on :5432 (keep this terminal open)
cp apps/api/.env.example apps/api/.env
npm run dev         # api on :3001, web on :5173
```

Sign up at http://localhost:5173, open the Arena, register. To fill a box, in
another terminal:

```sh
npm run bots -- --n 99          # 99 bots sign up, register and enter the arena
```

then, signed in as the admin from `.env`, press **Start now** on `/admin`. A
10-second countdown runs and the box goes live. Placements and points land on
`/events/:id` and `/leaderboard` when it ends.

`npm test` runs the rules, engine and room-server suites. `npm run build` builds everything.

## The engine

The game engine sits behind a small interface (`init`, `step`, `state`, snapshot). The
**stub** engine is a deterministic box-fighter that lets the whole platform run end to
end. The **Melee** engine is the game's own fighter/physics/collision code from the
matching decompilation compiled to WebAssembly; its build and status are in
[`docs/ENGINE.md`](docs/ENGINE.md) and [`packages/engine/README.md`](packages/engine/README.md).

No game data is in this repository or served by the site. Players supply their own
disc image, which is read in the browser and never uploaded.

## Legal

Not affiliated with Nintendo. The platform code is the author's; the engine build
consumes the [Melee decompilation](https://github.com/doldecomp/melee) and the
[pc-port](https://github.com/GurekamDhillon/melee/tree/pc-port) platform layer
(GPL-2.0-or-later) at build time and does not vendor them.
