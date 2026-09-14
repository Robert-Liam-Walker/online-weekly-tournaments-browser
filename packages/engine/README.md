# @owt/engine

The game engine boundary for the browser royale. Two implementations sit behind one
`Engine` interface (`@owt/shared`, `engine-types.ts`):

| Kind | What | Status |
|---|---|---|
| `stub` | Deterministic placeholder sim: box arena, stamina HP, hits, knockback, eliminations. The same code runs on the room server (authority) and in the browser (prediction and rendering). | Shipped. Runs the platform end to end today. |
| `wasm` | Super Smash Bros. Melee's own fighter, physics and collision code from the [matching decompilation](https://github.com/doldecomp/melee), compiled to WebAssembly. | In progress. See `build/` and `docs/ENGINE.md`. |

The room server, the protocol, the lobby, results and leaderboard never know which
one is running. Swapping the stub for the wasm engine is a one-line config change
(`ENGINE_KIND=wasm`).

## The wasm engine, in one paragraph

The decomp is C, but it is C written for a big-endian, 32-bit PowerPC whose data
files (`.dat` HSD archives, textures, display lists) are read in place as structs.
The [pc-port](https://github.com/GurekamDhillon/melee/tree/pc-port) solved this
with `gwtool`: clang's PowerPC front-end emits LLVM IR, `gwtool` rewrites every
load and store through `llvm.bswap` (memory stays byte-identical to a GameCube,
values are native in registers), prefixes symbols with `gw_`, verifies that every
struct layout is unchanged under the new data layout, and retargets to i686.
WebAssembly is also ILP32, so the same transform retargets to
`wasm32-unknown-emscripten` with a target-triple change; `gwtool` already has
`--emit bc`. The GameCube SDK is then provided by the same native shims
(`pc/platform/*.c`), compiled with `emcc`, with the OS/DVD/CARD/PAD shims pointed
at browser primitives (the player's own disc image read from a `File`, IndexedDB
for the memory card, the Gamepad API for pads) and rendering through Aurora, which
already speaks WebGPU.

No game data is in this repository or served by the site. The player supplies
their own legally dumped NTSC 1.02 (`GALE01`) disc image; the browser reads only
the files the engine asks for and keeps them in IndexedDB on that machine.

## Layout

```
src/stub/StubEngine.ts   the placeholder sim (+ tests)
src/wasm/WasmEngine.ts   loader + C ABI for the wasm module (owt_init/owt_step/...)
build/                   Linux/CI build of the wasm engine from the pc-port
wasm/                    build output (engine.wasm), gitignored
```
