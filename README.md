# Online Weekly Tournament Series, browser edition

A free weekly Super Smash Bros. Melee tournament that runs in the browser: a
**double-elimination bracket under the standard singles ruleset** (4 stock, 8 minutes,
stage striking, counterpicks, DSR, Bo3 and Bo5), every Friday at 8 PM Eastern.

This is the browser successor to the Slippi-based weekly (a bracket played inside a
Dolphin fork). The weekly slot, the brand, the domain and the format carry over; the
client is now a web page, and the ruleset is enforced by the platform.

## What is here

```
apps/web/          Vite + React site: landing, sign-up, arena (your set), bracket, leaderboard
apps/api/          Fastify API + socket.io match server + Prisma/Postgres + scheduler
packages/shared/   ruleset as data, set state machine, double-elim bracket, protocol, engine interface
packages/engine/   the engine boundary: deterministic stub today, decomp-derived wasm next
scripts/           local dev database (embedded Postgres) and a bot bracket for end-to-end runs
docs/              ARCHITECTURE.md, ENGINE.md, DEPLOY.md
```

## Run it locally

```sh
npm install
npm run db          # embedded Postgres on :5432 (keep this terminal open)
cp apps/api/.env.example apps/api/.env
npm run dev         # api on :3001, web on :5173
```

Sign up at http://localhost:5173, open the Arena, register. To fill a bracket:

```sh
npm run bots -- --n 7           # 7 bots sign up, register, enter the arena and play their sets
```

then, signed in as the admin from `.env`, press **Start now** on `/admin`. The lobby
opens, the bracket draws a minute later, and your first set appears in the arena.

`npm test` runs the rules, set, bracket, engine and match-room suites. `npm run build` builds everything.

## The engine

The game engine sits behind a small interface (init a game with a stage, two
characters, stocks and a clock; step; state; snapshot). The **stub** engine is a
deterministic box-fighter with percent, knockback, stocks and blast zones that lets
the whole platform run end to end. The **Melee** engine is the game's own fighter,
physics and collision code from the matching decompilation compiled to WebAssembly;
its build and status are in [`docs/ENGINE.md`](docs/ENGINE.md).

No game data is in this repository or served by the site. Players supply their own
disc image, which is read in the browser and never uploaded.

## Legal

Not affiliated with Nintendo. The platform code is the author's; the engine build
consumes the [Melee decompilation](https://github.com/doldecomp/melee) and the
[pc-port](https://github.com/GurekamDhillon/melee/tree/pc-port) platform layer
(GPL-2.0-or-later) at build time and does not vendor them.
