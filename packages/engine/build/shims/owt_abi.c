/* owt_abi.c: the C ABI exported by engine.wasm and consumed by WasmEngine.ts.
 *
 * One engine instance = one game of a set: two fighters, a stage, N stocks and a
 * clock. The host feeds per-slot inputs into the game's PAD shim, steps one
 * frame, and reads back a packed, little-endian mirror of each fighter's record
 * plus hit / KO / end events. Everything game-side stays big-endian behind
 * gw_* accessors (see pc/platform/gw.h).
 *
 * Status: ABI skeleton. The calls into the game (marked TODO) are the port work
 * tracked in docs/ENGINE.md; the stub engine covers the platform until then.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define OWT_MAX_EVENTS 64
enum { EV_HIT = 1, EV_KO = 2, EV_END = 3 };
enum { END_STOCKS = 0, END_TIMEOUT_STOCKS = 1, END_TIMEOUT_PERCENT = 2, END_TIMEOUT_REPLAY = 3, END_LGL = 4 };

typedef struct { uint32_t type, tick; int32_t a, b; float v; } owt_event;
typedef struct { uint32_t stocks; float percent, x, y, vx, vy; int32_t facing; uint32_t action, actionFrames, invincible, ledgeGrabs; uint32_t pad; } owt_player;
typedef struct { float x, y; uint32_t buttons; } owt_input;

static owt_player g_players[2];
static owt_input g_inputs[2];
static owt_event g_events[OWT_MAX_EVENTS];
static uint32_t g_tick, g_time_left, g_nevents, g_ended;

static void push_event(uint32_t type, int32_t a, int32_t b, float v) {
  if (g_nevents >= OWT_MAX_EVENTS) return;
  owt_event *e = &g_events[g_nevents++];
  e->type = type; e->tick = g_tick; e->a = a; e->b = b; e->v = v;
}

void owt_init(int seed, int stageId, int char0, int char1, int stocks, int timeFrames) {
  (void)seed; (void)stageId; (void)char0; (void)char1;
  g_tick = 0; g_time_left = (uint32_t)timeFrames; g_nevents = 0; g_ended = 0;
  memset(g_players, 0, sizeof g_players);
  g_players[0].stocks = g_players[1].stocks = (uint32_t)stocks;
  g_players[0].facing = 1; g_players[1].facing = -1;
  /* TODO(engine): boot a VS match on `stageId` with `char0` vs `char1`, `stocks`
   * stocks, items off, timer `timeFrames` (gm/ match init through gw_ shims). */
}

void owt_set_input(int slot, float x, float y, int buttons) {
  if (slot < 0 || slot > 1) return;
  g_inputs[slot].x = x; g_inputs[slot].y = y; g_inputs[slot].buttons = (uint32_t)buttons;
  /* TODO(engine): shim_pad reads g_inputs[slot] when the game polls PADRead. */
}

int owt_step(void) {
  g_nevents = 0;
  if (g_ended) return 0;
  g_tick++;
  if (g_time_left) g_time_left--;
  /* TODO(engine): run one game frame and mirror ftCo records into g_players;
   * push EV_HIT / EV_KO from the damage and death hooks, EV_END when the match
   * ends (a=winner slot or -1, b=END_* reason). */
  if (g_time_left == 0 && !g_ended) {
    int w = -1, reason = END_TIMEOUT_REPLAY;
    if (g_players[0].stocks != g_players[1].stocks) { w = g_players[0].stocks > g_players[1].stocks ? 0 : 1; reason = END_TIMEOUT_STOCKS; }
    else if (g_players[0].percent != g_players[1].percent) { w = g_players[0].percent < g_players[1].percent ? 0 : 1; reason = END_TIMEOUT_PERCENT; }
    g_ended = 1;
    push_event(EV_END, w, reason, 0.0f);
  }
  return (int)g_nevents;
}

uint32_t owt_events_ptr(void) { return (uint32_t)(uintptr_t)g_events; }
uint32_t owt_player_ptr(int slot) { return (uint32_t)(uintptr_t)&g_players[slot == 1 ? 1 : 0]; }
uint32_t owt_tick(void) { return g_tick; }
uint32_t owt_time_left(void) { return g_time_left; }
uint32_t owt_snapshot_size(void) { return sizeof g_players + 12; }
void owt_snapshot_write(uint8_t *dst) {
  memcpy(dst, &g_tick, 4); memcpy(dst + 4, &g_time_left, 4); memcpy(dst + 8, &g_ended, 4);
  memcpy(dst + 12, g_players, sizeof g_players);
}
void owt_snapshot_read(const uint8_t *src, uint32_t len) {
  if (len < owt_snapshot_size()) return;
  memcpy(&g_tick, src, 4); memcpy(&g_time_left, src + 4, 4); memcpy(&g_ended, src + 8, 4);
  memcpy(g_players, src + 12, sizeof g_players);
}
void *owt_malloc(uint32_t n) { return malloc(n); }
void owt_free(void *p) { free(p); }
