import * as THREE from "three";

const HIDDEN_Y = -999;

/** Pooled hit sparks: one THREE.Points object (= one draw call) for every burst. */
export class Sparks {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private life: Float32Array;
  private attr: THREE.BufferAttribute;
  private next = 0;

  constructor(private max = 256) {
    this.positions = new Float32Array(max * 3).fill(HIDDEN_Y);
    this.velocities = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.positions, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.attr);
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffb24a,
        size: 0.14,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  burst(at: THREE.Vector3, count: number) {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      const up = 0.3 + Math.random() * 0.9;
      this.positions.set([at.x, at.y, at.z], i * 3);
      this.velocities.set([Math.cos(a) * speed, up * speed, Math.sin(a) * speed], i * 3);
      this.life[i] = 0.3 + Math.random() * 0.3;
    }
  }

  update(dt: number) {
    const p = this.positions;
    const v = this.velocities;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      v[k + 1] -= 14 * dt;
      p[k] += v[k] * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += v[k + 2] * dt;
      if (this.life[i] <= 0) p[k + 1] = HIDDEN_Y;
    }
    this.attr.needsUpdate = true;
  }
}

const DUST_HALF = 14;
const DUST_HEIGHT = 4;

/**
 * Slow-drifting dust motes in a box that follows the camera target
 * (particles wrap around the box edges). One draw call.
 */
export class Dust {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private drift: Float32Array;
  private attr: THREE.BufferAttribute;
  private time = 0;

  constructor(
    private count: number,
    texture: THREE.Texture,
  ) {
    this.positions = new Float32Array(count * 3);
    this.drift = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.positions.set(
        [(Math.random() * 2 - 1) * DUST_HALF, Math.random() * DUST_HEIGHT, (Math.random() * 2 - 1) * DUST_HALF],
        i * 3,
      );
      this.drift.set([(Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.3], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.positions, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.attr);
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: texture,
        // Drifting embers rather than grey dust: the sheets' ember-lit look
        color: 0xff7a40,
        size: 0.1,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  update(dt: number, center: THREE.Vector3) {
    this.time += dt;
    const p = this.positions;
    const d = this.drift;
    const wrap = (v: number, c: number, half: number) => {
      const rel = v - c;
      return rel > half ? v - half * 2 : rel < -half ? v + half * 2 : v;
    };
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      p[k] = wrap(p[k] + d[k] * dt, center.x, DUST_HALF);
      p[k + 1] = ((p[k + 1] + d[k + 1] * dt + Math.sin(this.time + i) * 0.002) % DUST_HEIGHT + DUST_HEIGHT) % DUST_HEIGHT;
      p[k + 2] = wrap(p[k + 2] + d[k + 2] * dt, center.z, DUST_HALF);
    }
    this.attr.needsUpdate = true;
  }
}

/** Trauma-based screen shake: add() on impacts, offset() every frame. */
export class CameraShake {
  private trauma = 0;
  private offsetV = new THREE.Vector3();

  add(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  offset(dt: number): THREE.Vector3 {
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.trauma * this.trauma * 0.6;
    const r = () => Math.random() * 2 - 1;
    return this.offsetV.set(r() * s, r() * s * 0.5, r() * s);
  }
}
