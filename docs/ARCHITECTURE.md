# Architecture

## 1. Deployment view

```
                Route53: onlineweeklytournaments.com
                              |
                         CloudFront
                        /           \
          S3 (Vite build)       Elastic Beanstalk (one Docker container)
          /*  static site       /api/*  Fastify REST
                                /socket.io/*  socket.io: /lobby, /room
                                      |
                                 RDS Postgres
```

One API process does everything: REST, sockets, the scheduler and the live rooms.
Rooms are in memory; a restart mid-box voids that box. That is an accepted MVP
trade-off (the event is 8 minutes long, once a week); horizontal scaling is a
sticky-session or dedicated-room-host change and nothing in the protocol prevents it.

## 2. Data model

| Model | Purpose |
|---|---|
| `User` | username, email, bcrypt hash, role |
| `WeeklyEvent` | `scheduledAt`, `status` SCHEDULED, LOBBY, LIVE, COMPLETE, CANCELLED |
| `Registration` | (user, event) unique |
| `Placement` | (event, user) unique: roomIndex, place, entrants, kos, points |

Leaderboard = `Placement` grouped by user. Nothing live is persisted.

## 3. Event lifecycle

```
SCHEDULED --(T-15 min, scheduler)--> LOBBY --(T, scheduler or admin)--> LIVE --(last room ends)--> COMPLETE
    \_______________________________ admin cancel _______________________________/ CANCELLED
```

- The scheduler (`apps/api/src/scheduler.ts`) runs every 5 s: guarantees one upcoming
  event exists (next Friday 20:00 America/New_York, DST-safe), opens lobbies, goes live.
- **Present** = registered and connected to `/room` for that event while it is
  SCHEDULED or LOBBY. Going live partitions the present set into rooms of at most
  `ROOM_CAP` (100), as evenly as possible, with a seeded shuffle.
- Fewer than `MIN_PLAYERS` present: the event completes with no placements.

## 4. Room protocol (`/room`, socket.io, JWT in handshake)

| Direction | Event | Payload |
|---|---|---|
| c -> s | `room:join` | `{eventId}`, ack `RoomWelcome` or `{error}` |
| c -> s | `room:input` | `{input: {x, y, buttons}}` at 60 Hz |
| s -> c | `room:assigned` | slot, roomIndex, startAt, seed, roster, engine |
| s -> c | `room:phase` | waiting, countdown, live, finished, voided |
| s -> c | `room:snapshot` | packed world at 20 Hz (`packWorld`) |
| s -> c | `room:events` | hit / elim / end, as they happen |
| s -> c | `room:result` | place, entrants, points, kos, sent the moment a player is out |

The server is authoritative: it steps the engine at 60 Hz from the latest input per
slot (a coarse 4 ms timer with a wall-clock accumulator; at most 10 frames per pump so
a stall drops frames rather than spiralling). Clients interpolate between the last two
snapshots. There is no client prediction yet; the engine is deterministic and
snapshottable specifically so that can be added.

## 5. Engine boundary

`@owt/shared` `Engine`: `init(seed, slots, staminaHp)`, `step(inputs) -> events`,
`state()`, `forceEnd()`, `serialize()/deserialize()`. Two implementations in
`@owt/engine`; see [ENGINE.md](ENGINE.md). The room server selects by
`ENGINE_KIND` and falls back to the stub when `engine.wasm` is absent.

## 6. Points

`placementPoints(place, entrants)`: 100 for a win, otherwise
`max(1, round(60 f^2 + 10 f))` where `f` is the fraction of the field outlasted.
Tested monotonic and field-size aware in `packages/shared/src/rules.test.ts`.

## 7. Tests

- `packages/shared`: points, room partitioning, weekly schedule across DST.
- `packages/engine`: determinism, a full 100-fighter box to a single winner with
  every place assigned once, forceEnd ranking, snapshot round-trip.
- `apps/api`: room phase machine and 60 Hz stepping, a full room to completion with
  results delivered and persisted once, spectator/input gating, reconnect.
- `scripts/bots.mjs`: live 100-bot box against a running server.
