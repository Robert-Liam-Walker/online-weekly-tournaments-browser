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
| 2 | `gwtool` with a `--triple wasm32-unknown-emscripten` option | not started | needs LLVM dev libs: Linux/CI (`.github/workflows/engine.yml`); Windows LLVM installer ships no `LLVMCore.lib` |
| 3 | All 989 game TUs through clang + gwtool to wasm32 bitcode | not started | `packages/engine/build/build.sh` stage 3 |
| 4 | Shims under `TARGET_WASM`: DVD from a `File`, CARD in IndexedDB, PAD from Gamepad API, AX via SDL3 audio, GX via Aurora/WebGPU | not started | `pc/platform/*.c` + `packages/engine/build/shims/` |
| 5 | `owt_*` ABI (`owt_abi.c`) driving a stamina VS match with N fighters on a box stage; headless mode for the room server | not started | `packages/engine/build/shims/owt_abi.c` is the ABI skeleton; `WasmEngine.ts` is the loader |
| 6 | 100 fighters: the game hard-codes 6 fighter slots (`ftCo`/`Player` arrays, `gm` match structs); the royale needs the fighter table widened and per-fighter memory pooled | not started | the one true game-code change; everything else is platform |

Stage 6 is the honest headline risk. Melee Royale's author did it (100 in a box), which
tells us it is feasible on the same codebase; it does not tell us how. The likely shape:
the fighter table (`Fighter`, `ftCo_GObj` allocation, `Player` block) becomes
dynamically sized under `TARGET_WASM`, the match-init code loops over N, and the
camera/HUD paths that assume 4 (or 6) are bypassed by the host, which renders its own HUD.

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
