// Keyboard + Gamepad -> PlayerInput. Keyboard: arrows or WASD to move, Space or
// Z to jump, X or J to attack, Shift or K to shield. Any connected gamepad wins
// when its stick or buttons are active (standard mapping: A jump, X attack,
// LB/RB shield).
import { BTN, type PlayerInput } from "@owt/shared";

const keys = new Set<string>();
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.type === "keydown") keys.add(e.code); else keys.delete(e.code);
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
}

export function startInput(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  window.addEventListener("blur", () => keys.clear());
}

export function stopInput(): void {
  if (!listening) return;
  listening = false;
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("keyup", onKey);
  keys.clear();
}

export function readInput(): PlayerInput {
  let x = 0, y = 0, buttons = 0;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) x -= 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) x += 1;
  if (keys.has("ArrowUp") || keys.has("KeyW")) y += 1;
  if (keys.has("ArrowDown") || keys.has("KeyS")) y -= 1;
  if (keys.has("Space") || keys.has("KeyZ")) buttons |= BTN.JUMP;
  if (keys.has("KeyX") || keys.has("KeyJ")) buttons |= BTN.A;
  if (keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("KeyK")) buttons |= BTN.SHIELD;
  if (keys.has("KeyC") || keys.has("KeyL")) buttons |= BTN.B;

  const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
  for (const g of pads) {
    if (!g) continue;
    const gx = g.axes[0] ?? 0, gy = -(g.axes[1] ?? 0);
    const dead = 0.25;
    const px = Math.abs(gx) > dead ? gx : 0, py = Math.abs(gy) > dead ? gy : 0;
    const b = (i: number) => !!g.buttons[i]?.pressed;
    let gb = 0;
    if (b(0) || b(3)) gb |= BTN.JUMP;      // A / Y
    if (b(2)) gb |= BTN.A;                 // X
    if (b(1)) gb |= BTN.B;                 // B
    if (b(4) || b(5) || b(6) || b(7)) gb |= BTN.SHIELD;
    if (b(14)) x -= 1; if (b(15)) x += 1;  // d-pad
    if (px || py || gb) { x = px || x; y = py || y; buttons |= gb; }
  }
  return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), buttons };
}
