#!/usr/bin/env bash
# Builds packages/engine/wasm/engine.wasm from the Melee pc-port. Linux only (the
# LLVM dev packages gwtool links against ship with apt; on Windows use WSL or CI).
#
# Stages (each is a gate; the script stops at the first failure and says which):
#   1. toolchain: clang with PowerPC + WebAssembly targets, llvm-dev, emsdk
#   2. gwtool: build the IR retargeter with a wasm32 target (gwtool.wasm32.patch)
#   3. game TUs: clang (ppc32 front-end) -> gwtool (bswap + retarget) -> .bc
#   4. shims: pc/platform/*.c plus our browser shims, under TARGET_WASM
#   5. link: emcc everything into engine.wasm exporting the owt_* ABI
#
# Usage: ./build.sh [--pc-port-ref <git ref>] [--out <dir>]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../wasm"
REF="pc-port"
WORK="${OWT_ENGINE_WORK:-$HERE/.work}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pc-port-ref) REF="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown arg $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$WORK" "$OUT"

stage() { echo; echo "=== [$1] $2"; }

stage 1 "toolchain"
CLANG="${CLANG:-clang}"
# clang-22 -> clang++-22 (versioned apt names put the suffix after the ++)
CLANGXX="${CLANGXX:-${CLANG/clang/clang++}}"
LLVM_CONFIG="${LLVM_CONFIG:-llvm-config}"
command -v "$CLANG" >/dev/null || { echo "clang not found (apt install clang llvm-dev)"; exit 1; }
"$CLANG" -print-targets | grep -q ppc || { echo "clang lacks the ppc target"; exit 1; }
"$CLANG" -print-targets | grep -q wasm32 || { echo "clang lacks the wasm32 target"; exit 1; }
command -v "$LLVM_CONFIG" >/dev/null || { echo "llvm-config not found (apt install llvm-dev)"; exit 1; }
command -v emcc >/dev/null || { echo "emcc not found (source emsdk_env.sh)"; exit 1; }
echo "clang: $("$CLANG" --version | head -1)"
echo "llvm:  $("$LLVM_CONFIG" --version)"
echo "emcc:  $(emcc --version | head -1)"

stage 2 "gwtool (wasm32 target)"
if [[ ! -d "$WORK/melee" ]]; then
  git clone --depth=1 --branch "$REF" https://github.com/GurekamDhillon/melee.git "$WORK/melee"
fi
if [[ -s "$HERE/gwtool.wasm32.patch" ]] && grep -q '^diff --git' "$HERE/gwtool.wasm32.patch"; then
  ( cd "$WORK/melee" && git apply --check "$HERE/gwtool.wasm32.patch" && git apply "$HERE/gwtool.wasm32.patch" ) || echo "patch already applied"
else
  echo "gwtool.wasm32.patch is not a diff yet; stage 2 will fail at --triple until it is (see docs/ENGINE.md)"
fi
mkdir -p "$WORK/gwtool"
"$CLANGXX" -std=c++17 -O2 $("$LLVM_CONFIG" --cxxflags) "$WORK/melee/pc/tools/gwtool/gwtool.cpp" \
  -o "$WORK/gwtool/gwtool" $("$LLVM_CONFIG" --ldflags --libs core irreader bitwriter passes target powerpc webassembly x86 support) -lpthread -lz
"$WORK/gwtool/gwtool" --help | grep -q -- '--triple' || { echo "gwtool has no --triple option: the wasm32 patch is not applied"; exit 1; }

stage 3 "game translation units"
( cd "$WORK/melee" && [[ -d build/GALE01/include ]] || python3 configure.py >/dev/null 2>&1 || true )
mkdir -p "$WORK/out"
fail=0; ok=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  n="$(echo "$f" | tr '/' '_')"
  if "$CLANG" --target=ppc32-none-eabi -std=c99 -nostdinc -fno-builtin -DLINT -DTARGET_PC -DTARGET_WASM \
      -fno-short-enums -fsigned-char -mlong-double-64 -fno-strict-aliasing -fwrapv -fcommon -fgnu89-inline \
      -ftrivial-auto-var-init=zero -O2 -Xclang -disable-llvm-passes -emit-llvm -c -w \
      -I"$WORK/melee/src" -isystem "$WORK/melee/src/MSL" -isystem "$WORK/melee/extern/dolphin/include" \
      -isystem "$WORK/melee/extern/dolphin/src" -isystem "$WORK/melee/build/GALE01/include" \
      -include "$WORK/melee/src/MSL/math_ppc.h" "$WORK/melee/$f" -o "$WORK/out/$n.ppc.bc" 2>"$WORK/out/$n.cc.err" \
     && "$WORK/gwtool/gwtool" "$WORK/out/$n.ppc.bc" -o "$WORK/out/$n.bc" --emit bc --triple wasm32-unknown-emscripten 2>"$WORK/out/$n.gw.err"; then
    ok=$((ok+1))
  else
    fail=$((fail+1)); echo "FAIL $f"; head -3 "$WORK/out/$n.cc.err" "$WORK/out/$n.gw.err" 2>/dev/null || true
  fi
done < "$WORK/melee/pc/build/masstest/files.txt"
echo "game TUs: ok=$ok fail=$fail"
[[ $fail -eq 0 ]] || { echo "stage 3 failed"; exit 1; }

stage 4 "platform shims"
mkdir -p "$WORK/shim"
for s in "$WORK"/melee/pc/platform/*.c "$HERE"/shims/*.c; do
  [[ -f "$s" ]] || continue
  emcc -c -O2 -DTARGET_PC -DTARGET_WASM -I"$WORK/melee/extern/aurora/include" -I"$WORK/melee/pc/platform" -I"$HERE/shims" "$s" -o "$WORK/shim/$(basename "$s").o"
done

stage 5 "link"
emcc -O2 "$WORK"/out/*.bc "$WORK"/shim/*.o \
  -sEXPORTED_FUNCTIONS=_owt_init,_owt_set_input,_owt_step,_owt_force_end,_owt_events_ptr,_owt_player_ptr,_owt_tick,_owt_alive,_owt_snapshot_size,_owt_snapshot_write,_owt_snapshot_read,_owt_malloc,_owt_free \
  -sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB --no-entry \
  -o "$OUT/engine.wasm"
ls -la "$OUT/engine.wasm"
echo "ENGINE_BUILD_OK"
