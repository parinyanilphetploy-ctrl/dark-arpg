import * as THREE from "three";

export type FloatKind = "normal" | "crit" | "player" | "xp" | "heal" | "level";

interface FloatText {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  life: number;
  pop: boolean;
}

/**
 * DOM elements pinned to 3D positions: floating damage numbers and
 * monster health bars. DOM text is crisp on every screen and costs no draw calls.
 */
export class WorldLabels {
  private floats: FloatText[] = [];
  private pool: HTMLElement[] = [];
  private v = new THREE.Vector3();

  constructor(
    private root: HTMLElement,
    private camera: THREE.Camera,
  ) {}

  /** Floating number / text that rises and fades at `at`. */
  float(at: THREE.Vector3, text: string, kind: FloatKind) {
    const el = this.pool.pop() ?? document.createElement("div");
    el.className = `float float-${kind}`;
    el.textContent = text;
    this.root.appendChild(el);
    // Small random spread so stacked hits don't overlap exactly
    const pos = at.clone();
    pos.x += (Math.random() - 0.5) * 0.4;
    this.floats.push({ el, pos, age: 0, life: kind === "crit" ? 1.1 : 0.9, pop: kind === "crit" });
  }

  createBar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "hpbar";
    bar.appendChild(document.createElement("div")).className = "hpbar-fill";
    bar.style.display = "none";
    this.root.appendChild(bar);
    return bar;
  }

  /** Show `bar` above `world` filled to `ratio`. */
  placeBar(bar: HTMLElement, world: THREE.Vector3, ratio: number) {
    if (!this.place(bar, world)) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "";
    (bar.firstChild as HTMLElement).style.transform = `scaleX(${ratio})`;
  }

  /** Call after the camera has moved this frame. */
  update(dt: number) {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.age += dt;
      if (f.age >= f.life) {
        f.el.remove();
        this.pool.push(f.el);
        this.floats.splice(i, 1);
        continue;
      }
      f.pos.y += dt * 1.4;
      const t = f.age / f.life;
      f.el.style.opacity = String(1 - t * t);
      const scale = f.pop && f.age < 0.12 ? 1.5 : 1;
      this.place(f.el, f.pos, scale);
    }
  }

  /** Position `el` at the screen projection of `world`. Returns false if behind the camera. */
  place(el: HTMLElement, world: THREE.Vector3, scale = 1): boolean {
    this.v.copy(world).project(this.camera);
    if (this.v.z > 1) return false;
    const x = (this.v.x + 1) * 0.5 * window.innerWidth;
    const y = (1 - this.v.y) * 0.5 * window.innerHeight;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${scale})`;
    return true;
  }
}
