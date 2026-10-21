import * as THREE from "three";

/**
 * Unified input: keyboard / mouse / touch all end up as the same "intent"
 * the game reads each update.
 *  - move:    WASD / arrows, or the on-screen joystick (setJoystick)
 *  - pointer: left mouse / tap on the world = move there
 *  - actions: keys, right mouse, or on-screen buttons (trigger)
 */
export type Action = "attack" | "skill1" | "skill2" | "skill3" | "skill4" | "potion" | "inventory";

const KEY_BINDINGS: Record<string, Action> = {
  Space: "attack",
  Digit1: "skill1",
  Digit2: "skill2",
  Digit3: "skill3",
  Digit4: "skill4",
  KeyQ: "potion",
  KeyI: "inventory",
};

export class Input {
  /** Movement direction on the ground plane (x, z), length 0..1. */
  readonly move = new THREE.Vector2();
  /** Pointer in normalized device coords (-1..1), for raycasting. */
  readonly pointer = new THREE.Vector2();
  pointerDown = false;
  /** True when the last pointer came from a mouse (aim attacks at it). */
  pointerIsMouse = true;

  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private joystick = new THREE.Vector2();
  /** Survives until the next update, so a tap shorter than one tick isn't lost. */
  private tapQueued = false;

  constructor(target: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const action = KEY_BINDINGS[e.code];
      if (action) {
        this.pressed.add(action);
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    target.addEventListener("pointerdown", (e) => {
      this.setPointer(e);
      this.pointerIsMouse = e.pointerType === "mouse";
      if (e.button === 2) {
        this.pressed.add("attack");
        return;
      }
      if (e.button !== 0) return;
      this.pointerDown = true;
      this.tapQueued = true;
      target.setPointerCapture(e.pointerId);
    });
    target.addEventListener("pointermove", (e) => this.setPointer(e));
    const release = (e: PointerEvent) => {
      if (e.button === 0 || e.type === "pointercancel") this.pointerDown = false;
    };
    target.addEventListener("pointerup", release);
    target.addEventListener("pointercancel", release);
    target.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Call once per fixed update, before the game reads input. */
  poll() {
    if (this.joystick.lengthSq() > 0) {
      this.move.copy(this.joystick);
      return;
    }
    let x = 0;
    let y = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    this.move.set(x, y);
    if (this.move.lengthSq() > 1) this.move.normalize();
  }

  /** On-screen joystick value, x right / y down, length 0..1. */
  setJoystick(x: number, y: number) {
    this.joystick.set(x, y);
  }

  /** On-screen buttons call this. */
  trigger(action: Action) {
    this.pressed.add(action);
  }

  /** True if the pointer is held, or was tapped since the last update. */
  consumePointer(): boolean {
    const active = this.pointerDown || this.tapQueued;
    this.tapQueued = false;
    return active;
  }

  /** True once per key press (edge-triggered). */
  consume(action: Action): boolean {
    return this.pressed.delete(action);
  }

  private setPointer(e: PointerEvent) {
    this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }
}
