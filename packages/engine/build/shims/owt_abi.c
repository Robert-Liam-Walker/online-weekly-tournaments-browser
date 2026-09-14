/* owt_abi.c: the C ABI exported by engine.wasm and consumed by WasmEngine.ts.
 *
 * This is the seam between the room server / browser and the game. It owns the
 * fighter slots, feeds per-slot inputs into the game's PAD shim, steps one frame,
 * and mirrors the fighter records the host needs (position, HP, action) into a
 * packed, little-endian, host-readable array. Everything game-side stays
 * big-endian behind gw_* accessors (see pc/platform/gw.h).
 *
 * Status: ABI skeleton. The calls into the game (marked TODO) are the port work
 * tracked in docs/ENGINE.md; the stub engine covers the platform until then.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define OWT_MAX_SLOTS 100
#define OWT_MAX_EVENTS 512

enum { EV_HIT = 1, EV_ELIM = 2, EV_END = 3 };

typedef struct { uint32_t type, tick; int32_t a, b; float v; } owt_event;
typedef struct { uint32_t alive; float hp, x, y, vx, vy; int32_t facing; uint32_t action, actionFrames, kos; uint32_t pad; } owt_player;
typedef struct { float x, y; uint32_t buttons; } owt_input;

static owt_player g_players[OWT_MAX_SLOTS];
static owt_input g_inputs[OWT_MAX_SLOTS];
static owt_event g_events[OWT_MAX_EVENTS];
static uint32_t g_slots, g_tick, g_alive, g_nevents, g_ended;

static void push_event(uint32_t type, int32_t a, int32_t b, float v) {
  if (g_nevents >= OWT_MAX_EVENTS) return;
  owt_event *e = &g_events[g_nevents++];
  e->type = type; e->tick = g_tick; e->a = a; e->b = b; e->v = v;
}

void owt_init(int seed, int slots, int staminaHp) {
  (void)seed;
  g_slots = slots > OWT_MAX_SLOTS ? OWT_MAX_SLOTS : (uint32_t)(slots < 0 ? 0 : slots);
  g_tick = 0; g_alive = g_slots; g_nevents = 0; g_ended = 0;
  memset(g_players, 0, sizeof g_players);
  for (uint32_t i = 0; i < g_slots; i++) { g_players[i].alive = 1; g_players[i].hp = (float)staminaHp; g_players[i].facing = 1; }
  /* TODO(engine): boot the game into a VS match with g_slots fighters on the
   * royale box stage in stamina mode (gm/ + ft/ init through the gw_ shims). */
}

void owt_set_input(int slot, float x, float y, int buttons) {
  if (slot < 0 || (uint32_t)slot >= g_slots) return;
  g_inputs[slot].x = x; g_inputs[slot].y = y; g_inputs[slot].buttons = (uint32_t)buttons;
  /* TODO(engine): shim_pad reads g_inputs[slot] when the game polls PADRead. */
}

int owt_step(void) {
  g_nevents = 0;
  if (g_ended) return 0;
  g_tick++;
  /* TODO(engine): run one game frame (HSD_PadRenewMasterStatus -> gm frame ->
   * ft update) and mirror each fighter's record into g_players[i]; push EV_HIT /
   * EV_ELIM as the game's damage and KO hooks fire, EV_END when one remains. */
  return (int)g_nevents;
}

int owt_force_end(void) {
  g_nevents = 0;
  if (g_ended) return 0;
  /* Rank the remaining fighters by HP, lowest eliminated first. */
  uint32_t remaining = g_alive;
  while (remaining > 1) {
    int32_t low = -1;
    for (uint32_t i = 0; i < g_slots; i++)
      if (g_players[i].alive && (low < 0 || g_players[i].hp < g_players[low].hp)) low = (int32_t)i;
    g_players[low].alive = 0; remaining--; g_alive = remaining;
    push_event(EV_ELIM, low, -1, (float)(remaining + 1));
  }
  int32_t winner = -1;
  for (uint32_t i = 0; i < g_slots; i++) if (g_players[i].alive) { winner = (int32_t)i; break; }
  g_ended = 1;
  push_event(EV_END, winner, -1, 0.0f);
  return (int)g_nevents;
}

uint32_t owt_events_ptr(void) { return (uint32_t)(uintptr_t)g_events; }
uint32_t owt_player_ptr(int slot) { return (uint32_t)(uintptr_t)&g_players[slot < 0 ? 0 : slot]; }
uint32_t owt_tick(void) { return g_tick; }
uint32_t owt_alive(void) { return g_alive; }
uint32_t owt_snapshot_size(void) { return sizeof g_players + 16; }
void owt_snapshot_write(uint8_t *dst) {
  memcpy(dst, &g_tick, 4); memcpy(dst + 4, &g_alive, 4); memcpy(dst + 8, &g_slots, 4); memcpy(dst + 12, &g_ended, 4);
  memcpy(dst + 16, g_players, sizeof g_players);
}
void owt_snapshot_read(const uint8_t *src, uint32_t len) {
  if (len < owt_snapshot_size()) return;
  memcpy(&g_tick, src, 4); memcpy(&g_alive, src + 4, 4); memcpy(&g_slots, src + 8, 4); memcpy(&g_ended, src + 12, 4);
  memcpy(g_players, src + 16, sizeof g_players);
}
void *owt_malloc(uint32_t n) { return malloc(n); }
void owt_free(void *p) { free(p); }
