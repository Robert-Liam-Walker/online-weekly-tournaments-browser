import type { Engine } from "@owt/shared";
import { StubEngine } from "./stub/StubEngine.js";
import { EngineNotBuiltError, WasmEngine } from "./wasm/WasmEngine.js";

export { StubEngine, STAGES, WORLD, BLAST, ACT, BODY } from "./stub/StubEngine.js";
export type { Platform, StageGeometry } from "./stub/StubEngine.js";
export { WasmEngine, EngineNotBuiltError } from "./wasm/WasmEngine.js";

export type EngineKind = "stub" | "wasm";

/**
 * Create an engine. "wasm" needs a module source; when none is available it
 * throws EngineNotBuiltError so the caller can fall back to "stub" explicitly.
 */
export async function createEngine(kind: EngineKind, wasmSource?: Response | ArrayBuffer | Uint8Array): Promise<Engine> {
  if (kind === "stub") return new StubEngine();
  if (!wasmSource) throw new EngineNotBuiltError();
  return WasmEngine.load(wasmSource);
}
