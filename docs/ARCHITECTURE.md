# Architecture

## 1. Deployment view

```
                Route53: onlineweeklytournaments.com
                              |
                         CloudFront
                        /           \
          S3 (Vite build)       Elastic Beanstalk (one Docker container)
          /*  static site       /api/*  Fastify REST
                                /socket.io/*  socket.io: /lobby, /match
                                      |
                                 RDS Postgres
```

One API process does everything: REST, sockets, the scheduler and the live sets.
Live set state (picks, inputs, the game) is in memory; every set *result* is
persisted the moment it lands, so a restart rebuilds the bracket and restarts
only the unfinished sets from their first game.

## 2. Data model

| Model | Purpose |
|---|---|
| `User` | username, email, bcrypt hash, role |
| `WeeklyEvent` | `scheduledAt`, `status` SCHEDULED, LOBBY, LIVE, COMPLETE, CANCELLED; `seedOrder` once drawn |
| `Registration` | (user, event) unique |
| `TournamentMatch` | one row per bracket slot: players, winner, score, games (stage, characters, winner), forfeit |
| `Placement` | (event, user) unique: place, entrants, sets won/lost, points |

Leaderboard = `Placement` grouped by user.

## 3. Event lifecycle

```
SCHEDULED --(T-15 min)--> LOBBY --(T, or admin "start now" = T+60 s)--> LIVE --(bracket complete)--> COMPLETE
    \_________________________________ admin cancel _________________________________/ CANCELLED
```

- The scheduler (`apps/api/src/scheduler.ts`) runs every 5 s: guarantees one upcoming
  event (next Friday 20:00 America/New_York, DST-safe), opens lobbies, starts events,
  restores LIVE events after a restart.
- **Present** = registered and connected to `/match` for the event while it is
  SCHEDULED or LOBBY. At start the bracket is drawn from the present set, seeded by
  season points (ties shuffled). Fewer than 2 present: the event completes empty.

## 4. The bracket (`packages/shared/src/bracket.ts`)

Pure double elimination, padded to a power of two with byes (byes auto-complete
and cascade, which also covers forfeits). Match keys are stable: `W{r}-{n}`,
`L{r}-{n}`, `GF`, `GFR`. `getReadyMatches` drives room creation; `reportResult`
advances; `getPlacements` yields 1, 2, 3, 4, 5, 5, 7, 7... Sets are Bo3, and Bo5
for winners finals, losers finals, GF and the reset (`formatForMatch`).

## 5. The set (`packages/shared/src/set.ts`)

A pure state machine per set, unit-tested against the ruleset:

```
striking (1-2-1 from the neutrals) -> blind_pick -> ready -> playing
   ^                                                            |
   |            game 2+: ban (Bo3 only) -> counterpick (DSR) -> winner_char -> loser_char -> ready -> playing
   +------------------------------------------------------------+
playing -> recordGame(winner)  -> next game or complete
playing -> recordGame(null)    -> tiebreak replay: same stage, 1 stock, 2 minutes
```

## 6. Match rooms (`apps/api/src/tournament/MatchRoom.ts`)

One room per playable set. It attaches the two players (reconnects replace the
link), applies actions through the set machine, launches each game as an
authoritative 60 Hz simulation (coarse 4 ms timer, wall-clock accumulator, at most
10 frames per pump), broadcasts packed snapshots at 20 Hz, records the engine's
`end` event into the set, and calls back when the set is decided. Clocks: a
player absent for 5 minutes before a set starts, or 3 minutes mid-set, forfeits.
`MatchView` is the single payload the client renders from.

## 7. Protocol (`/match`, socket.io, JWT in handshake)

| Direction | Event | Payload |
|---|---|---|
| c -> s | `match:join` | `{eventId}`, ack `MatchView` or `{error}` |
| c -> s | `match:action` | `{action}` (strike, blind_pick, ban, pick_stage, pick_char, ready), ack |
| c -> s | `match:input` | `{input: {x, y, buttons}}` at 60 Hz while live |
| s -> c | `match:view` | full `MatchView` on every change |
| s -> c | `match:snapshot` | packed world at 20 Hz |
| s -> c | `match:events` | hit / ko / end |

`/lobby` (public) pushes `lobby:event` (counts, status) and `lobby:bracket` (re-fetch).

## 8. Engine boundary

`Engine`: `init({seed, stage, characters, stocks, timeSeconds})`, `step([in0, in1])
-> events`, `state()`, `serialize()/deserialize()`. Two implementations in
`@owt/engine` (stub, wasm); see [ENGINE.md](ENGINE.md). The room selects by
`ENGINE_KIND` and falls back to the stub when `engine.wasm` is absent.

## 9. Tests

- `packages/shared`: ruleset data and helpers, the set machine (striking, bans, DSR,
  Bo5, tie-break replay, forfeit), the bracket (structure, byes, reset, 50 random
  simulations per field size).
- `packages/engine`: determinism, stocks to a win, respawn, time-out tie-breaks,
  snapshot round-trip.
- `apps/api`: the match room end to end (both players, striking, picks, countdown,
  a full Bo3 with counterpicks, no-show and disconnect forfeits, spectator gating).
- `scripts/bots.mjs`: N bots play a whole bracket against a running server.
