# The Melee engine: decomp to WebAssembly

Status board for the real engine. The platform runs on the stub until stage 5 lands.

## Why it is not "just recompile the C"

`doldecomp/melee` is a byte-matching decompilation (100% as of September 2026) of
NTSC 1.02 for the GameCube's PowerPC: big-endian, ILP32. The game reads its data
files (HSD `.dat` archives, textures, vertex arrays, display lists) in place as C
structs and relocates them, so a little-endian build breaks every data access.

The `pc-port` branch of GurekamDhillon/melee solves this once, at the IR level:

```
game .c  --clang --target=ppc32-none-eabi -emit-llvm-->  IR (BE layout)
         --gwtool: bswap every load/store, prefix symbols gw_,
                   verify aggregate layouts unchanged, retarget-->  i686 object
native shims (pc/platform/*.c): OS, DVD, CARD, PAD, AX, AR, VI, libc, GX->Aurora
Aurora (GC/Wii SDK reimplementation) on Dawn (WebGPU) -> D3D12
```

WebAssembly is also ILP32 with the same scalar alignments, so the same transform
retargets to `wasm32-unknown-emscripten` by changing the target triple; `gwtool`
already emits bitcode (`--emit bc`). Aurora already speaks WebGPU. SDL3 has an
Emscripten backend. That is the whole plan.

## Stages and status

| # | Stage | Status | Evidence |
|---|---|---|---|
| 0 | Decomp complete and linkable | done (upstream) | decomp.dev: 100.00% decompiled, 100.00% linked |
| 1 | Game TUs compile through clang's PowerPC front-end to IR with the pc-port flags | **proven locally** (2026-09-14) | `ftcoll.c` 15,168 lines IR, `ftlib.c`, `lbvector.c`, clang 22.1.8, `target datalayout = "E-m:e-p:32:32-Fn32-i64:64-n32"` |
| 2 | `gwtool` with a `--triple wasm32-unknown-emscripten` option | **done in CI** (2026-09-14, run 34878407633) | `packages/engine/build/gwtool.wasm32.patch` (27 lines: `--triple`, WebAssembly target init, `gwfix` section + `__start_gwfix` in `gw_runtime.c`); gwtool needs LLVM 21+ APIs, so CI installs LLVM 22 from apt.llvm.org (Ubuntu's 18 fails to compile it); Windows LLVM installer ships no dev libs |
| 3 | All 989 game TUs through clang + gwtool to wasm32 bitcode | **987 of 989 pass in CI** (2026-09-14); the two font TUs need `*_font.inc` generated from the disc and are skipped | `packages/engine/build/build.sh` stage 3; the LayoutChecker accepted every aggregate under the wasm32 data layout |
| 4 | Shims under `TARGET_WASM`: DVD from a `File`, CARD in IndexedDB, PAD from Gamepad API, AX via SDL3 audio, GX via Aurora/WebGPU | not started | `pc/platform/*.c` + `packages/engine/build/shims/` |
| 5 | `owt_*` ABI (`owt_abi.c`) driving a 1v1 VS match (stage, two characters, N stocks, timer, items off) with hit/KO/end hooks and a ledge-grab counter; headless mode for the match server | not started | `packages/engine/build/shims/owt_abi.c` is the ABI skeleton; `WasmEngine.ts` is the loader |
| 6 | Rules hooks the game does not expose as data: ledge-grab counting (LGL), pause off, the timed-out tie-break as a 1-stock rematch | not started | small `TARGET_WASM`-guarded hooks in `gm`/`ft`; everything else is platform |

A standard 1v1 VS match is exactly what the game already runs, so stage 5 is glue
(match init through the existing `gm` entry points, input through `shim_pad`,
reading `ftCo` records) rather than a game-code change. The one real port risk is
stage 4's rendering path: Aurora on browser WebGPU through Emscripten is plausible
but unproven; a Melee-Royale-style external renderer reading the game's HSD data is
the fallback.

## Assets and legality

The wasm module contains no game data. Stage 4's DVD shim serves reads from a disc
image the player picks with `<input type="file">`; only the files the game requests
(fighter and stage `.dat`s, effects, a handful of shared archives) are read, and they
are cached in IndexedDB on that machine. Nothing is uploaded. The site does not
distribute the game, its assets, or a modified game; it distributes a program that
runs the player's own copy.

## How to work on it

```sh
# Linux (or CI): apt install clang llvm-dev lld zlib1g-dev; source emsdk_env.sh
bash packages/engine/build/build.sh            # stops at the first failing stage
```

The Windows box can do stage 1 with the winget LLVM (`clang --target=ppc32-none-eabi`)
against a checkout of the pc-port; stages 2+ need LLVM dev libraries, which is why the
build runs on Ubuntu in `.github/workflows/engine.yml`.
