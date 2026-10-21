import type { Action, Input } from "../core/Input";

const JOYSTICK_RADIUS = 56; // px the knob can travel
const DEAD_ZONE = 0.12;

/**
 * Mobile controls: a floating joystick that appears wherever the left thumb
 * lands (inside the left zone), plus attack / skill buttons on the right.
 * Taps outside these elements fall through to the canvas = tap-to-move.
 */
export function createTouchControls(input: Input) {
  const hud = document.getElementById("hud")!;

  const zone = el("div", "joy-zone");
  const base = el("div", "joy-base");
  const knob = el("div", "joy-knob");
  base.appendChild(knob);
  zone.appendChild(base);
  hud.appendChild(zone);

  let activeId: number | null = null;
  let cx = 0;
  let cy = 0;

  const show = (x: number, y: number) => {
    cx = x;
    cy = y;
    base.style.left = `${x}px`;
    base.style.top = `${y}px`;
    base.classList.add("active");
  };

  const update = (x: number, y: number) => {
    let dx = x - cx;
    let dy = y - cy;
    const len = Math.hypot(dx, dy);
    if (len > JOYSTICK_RADIUS) {
      dx = (dx / len) * JOYSTICK_RADIUS;
      dy = (dy / len) * JOYSTICK_RADIUS;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / JOYSTICK_RADIUS;
    const ny = dy / JOYSTICK_RADIUS;
    const mag = Math.hypot(nx, ny);
    if (mag < DEAD_ZONE) input.setJoystick(0, 0);
    else input.setJoystick(nx, ny);
  };

  const end = () => {
    activeId = null;
    knob.style.transform = "";
    base.style.left = base.style.top = "";
    base.classList.remove("active");
    input.setJoystick(0, 0);
  };

  zone.addEventListener("pointerdown", (e) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      // pointer already gone (very quick tap) — moves still arrive while over the zone
    }
    const r = zone.getBoundingClientRect();
    show(e.clientX - r.left, e.clientY - r.top);
    update(e.clientX - r.left, e.clientY - r.top);
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activeId) return;
    const r = zone.getBoundingClientRect();
    update(e.clientX - r.left, e.clientY - r.top);
  });
  zone.addEventListener("pointerup", (e) => e.pointerId === activeId && end());
  zone.addEventListener("pointercancel", (e) => e.pointerId === activeId && end());

  // Right-hand buttons: big attack + 3 skill slots arranged around it
  const buttons = el("div", "touch-buttons");
  const make = (action: Action, label: string, cls: string) => {
    const b = el("button", `tbtn ${cls}`);
    b.textContent = label;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      input.trigger(action);
      b.classList.add("pressed");
    });
    const up = () => b.classList.remove("pressed");
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("pointerleave", up);
    buttons.appendChild(b);
  };
  make("attack", "⚔", "tbtn-attack");
  make("skill1", "1", "tbtn-s1");
  make("skill2", "2", "tbtn-s2");
  make("skill3", "3", "tbtn-s3");
  make("potion", "♥", "tbtn-potion");
  hud.appendChild(buttons);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string) {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
